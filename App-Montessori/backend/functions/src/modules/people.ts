import type { DocumentData } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from '../core/firebase';
import { fail, invalid } from '../core/errors';
import { createDoc } from '../core/store';
import type { Grant } from '../core/permissions';
import type { Ctx } from '../core/types';
import { asArr, asObj, normEmail, normPhone, randomCode, s, shortHash, todayOf, ChildDoc } from './util';

export const INVITE_TTL_DAYS = 14;

export interface ChildPerms { notify: boolean; viewFees: boolean; pickup: boolean }

export function normPerms(raw: unknown, base: Partial<ChildPerms> = {}): ChildPerms {
  const p = asObj(raw);
  return {
    notify: typeof p.notify === 'boolean' ? p.notify : base.notify ?? true,
    viewFees: typeof p.viewFees === 'boolean' ? p.viewFees : base.viewFees ?? false,
    pickup: typeof p.pickup === 'boolean' ? p.pickup : base.pickup ?? false,
  };
}

/** Tìm member (mọi loại) khớp số điện thoại hoặc email đã chuẩn hóa, trừ member đã bị thu hồi. */
export async function findMemberByContact(ctx: Ctx, phone: string, email: string): Promise<(DocumentData & { uid: string }) | null> {
  const found = new Map<string, DocumentData>();
  if (phone) (await ctx.col('members').where('phone', '==', phone).get()).forEach((d) => found.set(d.id, d.data()));
  if (email) (await ctx.col('members').where('email', '==', email).get()).forEach((d) => found.set(d.id, d.data()));
  for (const [uid, m] of found) if (m.status !== 'revoked') return { ...m, uid };
  return null;
}

export interface InviteSpec {
  kind: 'staff' | 'parent';
  email?: string;
  phone?: string;
  displayName: string;
  grants?: Grant[];
  childIds?: string[];
  childPerms?: Record<string, ChildPerms>;
  guardianLinkIds?: string[];
}

/** Tạo (hoặc gộp vào) lời mời đang chờ cùng loại + cùng email/số điện thoại: không tạo lời mời trùng. */
export async function upsertInvite(ctx: Ctx, spec: InviteSpec): Promise<{ id: string; code: string; merged: boolean }> {
  const email = spec.email || '';
  const phone = spec.phone || '';
  if (!email && !phone) invalid({ email: 'Nhập email hoặc số điện thoại.', phone: 'Nhập email hoặc số điện thoại.' });
  const matches = new Map<string, DocumentData>();
  if (phone) (await ctx.col('invites').where('phone', '==', phone).get()).forEach((d) => matches.set(d.id, d.data()));
  if (email) (await ctx.col('invites').where('email', '==', email).get()).forEach((d) => matches.set(d.id, d.data()));
  const existing = [...matches.entries()].find(([, v]) => v.status === 'pending' && v.kind === spec.kind);
  const expiresAt = Timestamp.fromMillis(ctx.now.getTime() + INVITE_TTL_DAYS * 86400_000);
  if (existing) {
    const [id, cur] = existing;
    const patch: Record<string, unknown> = {
      displayName: spec.displayName || cur.displayName,
      ...ctx.metaUpdate((cur.version as number) ?? 1),
    };
    if (email && !cur.email) patch.email = email;
    if (phone && !cur.phone) patch.phone = phone;
    if (spec.grants) patch.grants = spec.grants;
    if (spec.childIds?.length) patch.childIds = [...new Set([...(cur.childIds ?? []), ...spec.childIds])];
    if (spec.childPerms) patch.childPerms = { ...(cur.childPerms ?? {}), ...spec.childPerms };
    if (spec.guardianLinkIds?.length) patch.guardianLinkIds = [...new Set([...(cur.guardianLinkIds ?? []), ...spec.guardianLinkIds])];
    await ctx.doc(`invites/${id}`).update(patch);
    return { id, code: cur.code as string, merged: true };
  }
  const code = randomCode(8);
  const id = await createDoc(ctx, 'invites', undefined, {
    kind: spec.kind,
    email: email || null,
    phone: phone || null,
    displayName: spec.displayName,
    grants: spec.grants ?? [],
    childIds: spec.childIds ?? [],
    childPerms: spec.childPerms ?? {},
    guardianLinkIds: spec.guardianLinkIds ?? [],
    status: 'pending',
    code,
    expiresAt,
    invitedBy: ctx.uid,
  });
  return { id, code, merged: false };
}

export function linkIdFor(childId: string, phone: string, email: string): string {
  return `${childId}_${shortHash(phone || `e:${email}`)}`;
}

/** Đồng bộ ủy quyền đón tương ứng với người giám hộ có quyền `pickup`. */
export async function syncGuardianPickup(ctx: Ctx, child: ChildDoc, linkId: string, link: DocumentData): Promise<void> {
  const ref = ctx.doc(`pickupAuthorizations/pa_${linkId}`);
  const snap = await ref.get();
  const active = link.status !== 'unlinked' && link.perms?.pickup === true;
  if (active) {
    const data = {
      childId: child.id, campusId: child.campusId, personName: link.name, phone: link.phone || null, relation: link.relation || null,
      type: 'guardian', guardianLinkId: linkId, status: 'approved', validFrom: todayOf(ctx), validTo: null,
    };
    if (snap.exists) await ref.update({ ...data, revokedAt: null, revokedBy: null, ...ctx.metaUpdate(snap.data()!.version ?? 1) });
    else await ref.create({ ...data, ...ctx.metaCreate(), approvedBy: ctx.uid });
  } else if (snap.exists && snap.data()!.status !== 'revoked') {
    await ref.update({ status: 'revoked', revokedAt: Timestamp.fromDate(ctx.now), revokedBy: ctx.uid, revokeReason: 'Người giám hộ không còn quyền đón', ...ctx.metaUpdate(snap.data()!.version ?? 1) });
  }
}

export interface GuardianInput { name: string; phone?: string; email?: string; relation?: string }

/**
 * Liên kết người giám hộ với trẻ. Số điện thoại/email đã có member → liên kết trực tiếp (không tạo trùng);
 * chưa có → tạo/gộp lời mời parent kèm childIds. Quyền notify/viewFees/pickup tách riêng.
 */
export async function linkGuardianCore(ctx: Ctx, child: ChildDoc, g0: unknown, perms0: unknown): Promise<DocumentData & { id: string; inviteCode: string | null; warning?: string }> {
  const g = asObj(g0);
  const name = s(g.name);
  const phone = normPhone(g.phone);
  const email = normEmail(g.email);
  const errs: Record<string, string> = {};
  if (!name) errs['guardian.name'] = 'Bắt buộc nhập họ tên.';
  if (!phone && !email) errs['guardian.phone'] = 'Nhập số điện thoại hoặc email.';
  if (Object.keys(errs).length) invalid(errs);
  const relation = s(g.relation) || 'other';
  const linkId = linkIdFor(child.id, phone, email);
  const linkRef = ctx.doc(`guardianLinks/${linkId}`);
  const prev = await linkRef.get();
  const perms = normPerms(perms0, prev.exists ? (prev.data()!.perms as ChildPerms) : {});

  const member = await findMemberByContact(ctx, phone, email);
  let uid: string | null = null;
  let status: 'linked' | 'invited' = 'invited';
  let inviteId: string | null = null;
  let inviteCode: string | null = null;
  let warning: string | undefined;

  if (member && member.kind === 'parent') {
    uid = member.uid;
    status = 'linked';
  } else if (member) {
    warning = 'Số điện thoại/email này thuộc tài khoản nhân viên; cần tài khoản phụ huynh riêng để liên kết.';
  }
  if (status === 'invited') {
    const inv = await upsertInvite(ctx, {
      kind: 'parent', email, phone, displayName: name, childIds: [child.id], childPerms: { [child.id]: perms }, guardianLinkIds: [linkId],
    });
    inviteId = inv.id;
    inviteCode = inv.code;
  }

  const data = {
    childId: child.id, campusId: child.campusId, name, phone: phone || null, email: email || null, relation,
    uid, status, perms, inviteId, linkedAt: status === 'linked' ? Timestamp.fromDate(ctx.now) : null,
    unlinkedAt: null, unlinkReason: null,
  };
  let link: DocumentData;
  if (prev.exists) {
    await linkRef.update({ ...data, ...ctx.metaUpdate(prev.data()!.version ?? 1) });
    link = { ...prev.data(), ...data };
  } else {
    await createDoc(ctx, 'guardianLinks', linkId, data);
    link = data;
  }
  if (uid) {
    await ctx.doc(`members/${uid}`).update({
      childIds: FieldValue.arrayUnion(child.id),
      [`childPerms.${child.id}`]: perms,
      updatedAt: Timestamp.fromDate(ctx.now), updatedBy: ctx.uid, version: FieldValue.increment(1),
    });
  }
  await syncGuardianPickup(ctx, child, linkId, link);
  await ctx.audit({
    action: 'child.linkGuardian', collection: 'guardianLinks', docId: linkId, campusId: child.campusId,
    before: prev.exists ? { perms: prev.data()!.perms, status: prev.data()!.status } : null, after: { perms, status, uid },
  });
  return { ...link, id: linkId, inviteCode, warning };
}

export async function unlinkGuardianCore(ctx: Ctx, child: ChildDoc, linkId: string, reason?: string) {
  const linkRef = ctx.doc(`guardianLinks/${linkId}`);
  const snap = await linkRef.get();
  if (!snap.exists || snap.data()!.childId !== child.id) fail('NOT_FOUND', 'Liên kết người giám hộ không tồn tại.');
  const cur = snap.data()!;
  if (cur.status === 'unlinked') return { id: linkId, ...cur, alreadyUnlinked: true };
  const patch = { status: 'unlinked', unlinkedAt: Timestamp.fromDate(ctx.now), unlinkReason: s(reason) || null };
  await linkRef.update({ ...patch, ...ctx.metaUpdate(cur.version ?? 1) });
  if (cur.uid) {
    await ctx.doc(`members/${cur.uid}`).update({
      childIds: FieldValue.arrayRemove(child.id),
      [`childPerms.${child.id}`]: FieldValue.delete(),
      updatedAt: Timestamp.fromDate(ctx.now), updatedBy: ctx.uid, version: FieldValue.increment(1),
    }).catch(() => undefined);
  }
  if (cur.inviteId) {
    const invRef = ctx.doc(`invites/${cur.inviteId}`);
    const inv = await invRef.get();
    if (inv.exists && inv.data()!.status === 'pending') {
      const childIds = asArr<string>(inv.data()!.childIds).filter((c) => c !== child.id);
      const childPerms = { ...asObj(inv.data()!.childPerms) };
      delete childPerms[child.id];
      const guardianLinkIds = asArr<string>(inv.data()!.guardianLinkIds).filter((l) => l !== linkId);
      await invRef.update({ childIds, childPerms, guardianLinkIds, status: childIds.length ? 'pending' : 'revoked', ...ctx.metaUpdate(inv.data()!.version ?? 1) });
    }
  }
  await syncGuardianPickup(ctx, child, linkId, { ...cur, ...patch });
  await ctx.audit({ action: 'child.unlinkGuardian', collection: 'guardianLinks', docId: linkId, campusId: child.campusId, before: { status: cur.status, uid: cur.uid ?? null }, after: { status: 'unlinked' }, reason: s(reason) || undefined });
  return { id: linkId, ...cur, ...patch };
}
