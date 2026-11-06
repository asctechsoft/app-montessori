import type { DocumentData } from 'firebase-admin/firestore';
import { Timestamp, db, FieldValue } from '../core/firebase';
import { buildCtx } from '../core/context';
import { denied, fail, invalid } from '../core/errors';
import { createApproval, registerApprovalHandler, ApprovalDoc } from '../core/approvals';
import { createDoc, getOr404, updateDoc } from '../core/store';
import { hasPerm } from '../core/permissions';
import type { ActionMap, Ctx, Member } from '../core/types';
import { decideApprovalCore } from './approval-core';
import { asArr, asObj, campusOf, chunk, childOf, ID_PATTERN, parentUidsOfChild, parseWhen, pushToUsers, requireId, requireParentOf, s } from './util';

const IN_SCHOOL = ['active', 'trial', 'on_leave'];
const CATEGORIES = ['general', 'event', 'urgent', 'finance', 'health', 'menu'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

// ------------------------------------------------------------------ phạm vi người nhận

interface ScopeIn { type: 'org' | 'campus' | 'class' | 'users'; ids: string[] }

function normScope(raw: unknown): ScopeIn {
  const sc = asObj(raw);
  const type = s(sc.type);
  if (!['org', 'campus', 'class', 'users'].includes(type)) invalid({ scope: 'Phạm vi gửi phải là org, campus, class hoặc users.' });
  const ids = [...new Set(asArr<string>(sc.ids).map(s).filter(Boolean))];
  for (const i of ids) if (!ID_PATTERN.test(i)) invalid({ scope: 'Mã trong phạm vi không hợp lệ.' });
  if (type !== 'org' && !ids.length) invalid({ scope: 'Chọn ít nhất một đối tượng nhận.' });
  if (ids.length > 500) invalid({ scope: 'Tối đa 500 đối tượng nhận.' });
  return { type: type as ScopeIn['type'], ids: type === 'org' ? [] : ids };
}

interface Resolved { recipients: Map<string, { kind: string }>; campusIds: string[] }

/** Resolve người nhận phía server + (tùy chọn) kiểm tra quyền gửi tại từng cơ sở liên quan. */
async function resolveScope(ctx: Ctx, scope: ScopeIn, checkAuth: boolean): Promise<Resolved> {
  const req = (campusId: string | null) => { if (checkAuth && !ctx.can('notify.send', campusId)) denied('Bạn không có quyền gửi thông báo tới phạm vi này.'); };
  const members = (await ctx.col('members').where('status', '==', 'active').get()).docs.map((d) => ({ uid: d.id, ...(d.data() as DocumentData) })) as Array<DocumentData & { uid: string }>;
  const recipients = new Map<string, { kind: string }>();
  const campusIds = new Set<string>();
  const notifyChildren = (m: DocumentData, childSet?: Set<string>) =>
    (m.childIds ?? []).some((c: string) => (!childSet || childSet.has(c)) && m.childPerms?.[c]?.notify !== false);

  if (scope.type === 'org') {
    req(null);
    (await ctx.col('campuses').select().get()).docs.forEach((d) => campusIds.add(d.id));
    for (const m of members) {
      if (m.kind === 'parent' ? notifyChildren(m) : true) recipients.set(m.uid, { kind: m.kind });
    }
  } else if (scope.type === 'campus' || scope.type === 'class') {
    const childSet = new Set<string>();
    const classSet = new Set<string>();
    if (scope.type === 'campus') {
      for (const c of scope.ids) {
        const camp = await campusOf(ctx, c);
        req(camp.id);
        campusIds.add(camp.id);
        const q = await ctx.col('children').where('campusId', '==', camp.id).get();
        q.docs.filter((d) => IN_SCHOOL.includes(d.data().status)).forEach((d) => childSet.add(d.id));
      }
    } else {
      for (const k of scope.ids) {
        const cs = await ctx.doc(`classes/${k}`).get();
        if (!cs.exists) fail('NOT_FOUND', 'Lớp học không tồn tại trong tổ chức.');
        req(cs.data()!.campusId);
        campusIds.add(cs.data()!.campusId);
        classSet.add(k);
        const q = await ctx.col('children').where('classId', '==', k).get();
        q.docs.filter((d) => IN_SCHOOL.includes(d.data().status)).forEach((d) => childSet.add(d.id));
      }
    }
    let assignedUids = new Set<string>();
    if (scope.type === 'class') {
      for (const k of classSet) {
        (await ctx.col('assignments').where('classId', '==', k).get()).docs
          .filter((d) => d.data().status !== 'cancelled' && (!d.data().validTo || d.data().validTo.toMillis() > ctx.now.getTime()))
          .forEach((d) => assignedUids.add(d.data().uid));
      }
    }
    for (const m of members) {
      if (m.kind === 'parent') { if (notifyChildren(m, childSet)) recipients.set(m.uid, { kind: 'parent' }); continue; }
      if (scope.type === 'campus') {
        if (hasAnyAt(m, [...campusIds])) recipients.set(m.uid, { kind: m.kind });
      } else if (assignedUids.has(m.uid) || (m.grants ?? []).some((g: any) => (g.classIds ?? []).some((c: string) => classSet.has(c)))) {
        recipients.set(m.uid, { kind: m.kind });
      }
    }
    assignedUids = new Set();
  } else {
    // users: người nhận phải là thành viên org và có quan hệ với cơ sở mà người gửi có quyền gửi
    const byUid = new Map(members.map((m) => [m.uid, m]));
    for (const uid of scope.ids) {
      const m = byUid.get(uid);
      if (!m) invalid({ scope: 'Có người nhận không thuộc tổ chức hoặc chưa kích hoạt.' });
      const rel = await campusesOfMember(ctx, m!);
      const ok = rel.some((c) => !checkAuth || ctx.can('notify.send', c));
      if (!ok) denied('Bạn không có quyền gửi thông báo tới một số người nhận.');
      rel.forEach((c) => campusIds.add(c));
      recipients.set(uid, { kind: m!.kind });
    }
  }
  return { recipients, campusIds: [...campusIds] };
}

function hasAnyAt(m: DocumentData, campuses: string[]): boolean {
  const p = (m.permsByCampus ?? {}) as Record<string, string[]>;
  return campuses.some((c) => (p[c]?.length ?? 0) > 0 || (p['*']?.length ?? 0) > 0);
}

async function campusesOfMember(ctx: Ctx, m: DocumentData): Promise<string[]> {
  if (m.kind === 'parent') {
    const out = new Set<string>();
    for (const c of (m.childIds ?? []).slice(0, 20)) { const cs = await ctx.doc(`children/${c}`).get(); if (cs.exists) out.add(cs.data()!.campusId); }
    return [...out];
  }
  const keys = Object.keys(m.permsByCampus ?? {});
  if (keys.includes('*')) return (await ctx.col('campuses').select().get()).docs.map((d) => d.id);
  return keys;
}

// ------------------------------------------------------------------ gửi thông báo

async function deliver(ctx: Ctx, id: string, scope: ScopeIn, requireAck: boolean, checkAuth: boolean) {
  const ref = ctx.doc(`notifications/${id}`);
  // chiếm quyền gửi (chỉ một lần)
  const claimed = await ctx.tx(async (t) => {
    const sn = await t.get(ref);
    if (!sn.exists) fail('NOT_FOUND', 'Thông báo không tồn tại.');
    const st = sn.data()!.status;
    if (st === 'sent' || st === 'sending') return null;
    t.update(ref, { status: 'sending', ...ctx.metaUpdate((sn.data()!.version as number) ?? 1) });
    return { ...sn.data(), id } as DocumentData;
  });
  if (!claimed) { const cur = await getOr404(ref); return { ...cur, alreadySent: true }; }
  try {
    const { recipients } = await resolveScope(ctx, scope, checkAuth);
    const sentAt = Timestamp.fromDate(ctx.now);
    for (const part of chunk([...recipients.keys()], 400)) {
      const batch = db.batch();
      for (const uid of part) {
        batch.set(ctx.doc(`notificationReceipts/${id}_${uid}`), {
          notifId: id, uid, campusId: claimed.campusId ?? null, title: claimed.title, category: claimed.category, requireAck,
          sentAt, readAt: null, ackAt: null, recipientKind: recipients.get(uid)!.kind,
        });
      }
      await batch.commit();
    }
    await ref.update({
      status: 'sent', sentAt, sentBy: ctx.uid, scope, requireAck, recipientCount: recipients.size, scheduledAt: null,
      updatedAt: sentAt, updatedBy: ctx.uid, version: FieldValue.increment(1),
    });
    await ctx.audit({ action: 'notification.send', collection: 'notifications', docId: id, campusId: claimed.campusId ?? null, after: { scope, recipientCount: recipients.size, requireAck } });
    // push chung chung, không chứa nội dung chi tiết
    const pushed = await pushToUsers(ctx.orgId, [...recipients.keys()].filter((u) => u !== ctx.uid), { type: 'notification', notifId: id });
    return { id, status: 'sent', recipientCount: recipients.size, pushed };
  } catch (e) {
    await ref.update({ status: claimed.status, updatedAt: Timestamp.fromDate(ctx.now) }).catch(() => undefined);
    throw e;
  }
}

/** Dùng cho job định kỳ (BE-2 triggers): gửi các thông báo đã lên lịch tới hạn. Trả số thông báo đã gửi. */
export async function dispatchDueNotifications(now = new Date()): Promise<number> {
  const snap = await db.collectionGroup('notifications').where('status', '==', 'scheduled').where('scheduledAt', '<=', Timestamp.fromDate(now)).get();
  let n = 0;
  for (const d of snap.docs) {
    const orgId = d.ref.parent.parent!.id;
    const data = d.data();
    const member = { uid: data.scheduledBy ?? data.createdBy, displayName: 'Hệ thống', kind: 'owner', status: 'active', grants: [], childIds: [], permsByCampus: {}, version: 1 } as unknown as Member;
    const ctx = buildCtx({ uid: member.uid, token: {}, orgId, loadMember: false }, member, false);
    try {
      await deliver(ctx, d.id, data.scope, !!data.requireAck, false);
      n++;
    } catch (e) {
      console.error('dispatch notification failed', orgId, d.id, e);
      await d.ref.update({ status: 'failed', failReason: String((e as Error)?.message ?? e).slice(0, 300) }).catch(() => undefined);
    }
  }
  return n;
}

registerApprovalHandler('notification', {
  perm: 'notify.approve',
  async onApprove(ctx: Ctx, ap: ApprovalDoc) {
    const ref = ctx.doc(`notifications/${ap.refId}`);
    const n = await getOr404(ref, 'Thông báo');
    if (n.status !== 'pending_approval') fail('INVALID_STATE', 'Thông báo không còn chờ duyệt.', { status: n.status });
    await ref.update({ status: 'approved', approvedBy: ctx.uid, approvedAt: Timestamp.fromDate(ctx.now), ...ctx.metaUpdate((n.version as number) ?? 1) });
    return { notificationId: n.id, status: 'approved' };
  },
  async onReject(ctx: Ctx, ap: ApprovalDoc, note?: string) {
    const ref = ctx.doc(`notifications/${ap.refId}`);
    const n = await ref.get();
    if (n.exists && n.data()!.status === 'pending_approval') {
      await ref.update({ status: 'draft', rejectNote: s(note), rejectedBy: ctx.uid, ...ctx.metaUpdate((n.data()!.version as number) ?? 1) });
    }
    return null;
  },
});

function checkPaths(ctx: Ctx, campusId: string | null, paths: string[]): void {
  for (const p of paths) {
    const ok = typeof p === 'string' && !p.includes('..') && p.startsWith(campusId ? `orgs/${ctx.orgId}/campuses/${campusId}/` : `orgs/${ctx.orgId}/`);
    if (!ok) invalid({ attachmentPaths: 'Đường dẫn tệp đính kèm không hợp lệ.' });
  }
}

export const actions: ActionMap = {
  'notification.save': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = s(b.id);
      let existing: DocumentData | null = null;
      if (id) existing = await getOr404(ctx.doc(`notifications/${id}`), 'Thông báo');
      if (existing && !['draft', 'pending_approval'].includes(existing.status)) fail('INVALID_STATE', 'Thông báo đã gửi hoặc đã duyệt, không sửa được. Hãy tạo thông báo mới.');
      const scope = b.scope !== undefined ? normScope(b.scope) : (existing?.scope as ScopeIn | undefined);
      let campusId: string | null = existing ? ((existing.campusId as string | null) ?? null) : null;
      if (!existing) {
        if (scope?.type === 'org') campusId = null;
        else if (s(b.campusId)) campusId = (await campusOf(ctx, s(b.campusId))).id;
        else if (scope?.type === 'campus') campusId = scope.ids[0];
        else if (scope?.type === 'class') campusId = (await getOr404(ctx.doc(`classes/${scope.ids[0]}`), 'Lớp học')).campusId;
        else campusId = ctx.campusId ?? null;
      }
      if (campusId) await campusOf(ctx, campusId);
      ctx.require('notify.send', campusId);
      const title = s(b.title ?? existing?.title);
      const body = s(b.body ?? existing?.body);
      if (title.length < 2) invalid({ title: 'Nhập tiêu đề (tối thiểu 2 ký tự).' });
      if (title.length > 150) invalid({ title: 'Tiêu đề tối đa 150 ký tự.' });
      if (body.length < 1) invalid({ body: 'Nhập nội dung thông báo.' });
      if (body.length > 5000) invalid({ body: 'Nội dung tối đa 5000 ký tự.' });
      const category = s(b.category ?? existing?.category) || 'general';
      if (!(CATEGORIES as readonly string[]).includes(category)) invalid({ category: 'Loại thông báo không hợp lệ.' });
      const attachmentPaths = b.attachmentPaths !== undefined ? asArr<string>(b.attachmentPaths).map(s) : (existing?.attachmentPaths ?? []);
      checkPaths(ctx, campusId, attachmentPaths);
      const scheduledAt = b.scheduledAt ? Timestamp.fromDate(parseWhen(b.scheduledAt, 'scheduledAt')!) : (existing?.scheduledAt ?? null);
      const data = {
        title, body, category, attachmentPaths, campusId, scope: scope ?? null,
        requireAck: typeof b.requireAck === 'boolean' ? b.requireAck : (existing?.requireAck ?? false), scheduledAt,
      };
      if (!existing) {
        const nid = await createDoc(ctx, 'notifications', undefined, { ...data, status: 'draft', authorName: ctx.member?.displayName ?? ctx.uid });
        await ctx.audit({ action: 'notification.save', collection: 'notifications', docId: nid, campusId, after: { title, category } });
        return { id: nid, ...data, status: 'draft', version: 1 };
      }
      const { after } = await updateDoc(ctx, ctx.doc(`notifications/${id}`), { ...data, status: 'draft' }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'notification.save', collection: 'notifications', docId: id, campusId, before: { title: existing.title }, after: { title } });
      return { id, ...after };
    },
  },

  'notification.submit': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const n = await getOr404(ctx.doc(`notifications/${id}`), 'Thông báo');
      ctx.require('notify.send', n.campusId ?? null);
      if (n.status === 'pending_approval') return { id, status: 'pending_approval', unchanged: true };
      if (n.status !== 'draft') fail('INVALID_STATE', 'Chỉ gửi duyệt được thông báo ở trạng thái nháp.', { status: n.status });
      if (!n.scope) invalid({ scope: 'Chọn phạm vi người nhận trước khi gửi duyệt.' });
      const preview = await resolveScope(ctx, n.scope, true); // kiểm tra quyền + xem trước số người nhận
      if (ctx.can('notify.approve', n.campusId ?? null)) {
        const { after } = await updateDoc(ctx, ctx.doc(`notifications/${id}`), { status: 'approved', approvedBy: ctx.uid, approvedAt: Timestamp.fromDate(ctx.now), autoApproved: true, recipientPreview: preview.recipients.size });
        await ctx.audit({ action: 'notification.submit', collection: 'notifications', docId: id, campusId: n.campusId ?? null, after: { status: 'approved', autoApproved: true } });
        return { id, status: 'approved', autoApproved: true, recipientPreview: preview.recipients.size, version: after.version };
      }
      const approvalId = await createApproval(ctx, {
        type: 'notification', campusId: n.campusId ?? null, refCollection: 'notifications', refId: id,
        summary: `Duyệt thông báo "${n.title}" gửi tới ${preview.recipients.size} người.`,
        impact: { recipients: preview.recipients.size, scope: n.scope, requireAck: n.requireAck, category: n.category },
      });
      const { after } = await updateDoc(ctx, ctx.doc(`notifications/${id}`), { status: 'pending_approval', approvalId, recipientPreview: preview.recipients.size });
      await ctx.audit({ action: 'notification.submit', collection: 'notifications', docId: id, campusId: n.campusId ?? null, after: { status: 'pending_approval', approvalId } });
      return { id, status: 'pending_approval', approvalId, recipientPreview: preview.recipients.size, version: after.version };
    },
  },

  'notification.approve': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const n = await getOr404(ctx.doc(`notifications/${requireId(b.id, 'id')}`), 'Thông báo');
      if (!n.approvalId) fail('INVALID_STATE', 'Thông báo chưa được gửi duyệt.');
      const r: any = await decideApprovalCore(ctx, n.approvalId, s(b.decision) || 'approved', s(b.note));
      return { id: n.id, approvalId: n.approvalId, status: r.status, result: r.result ?? null };
    },
  },

  'notification.send': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const n = await getOr404(ctx.doc(`notifications/${id}`), 'Thông báo');
      ctx.require('notify.send', n.campusId ?? null);
      if (n.status === 'sent') return { id, status: 'sent', alreadySent: true, recipientCount: n.recipientCount ?? null };
      const scope = b.scope !== undefined ? normScope(b.scope) : (n.scope as ScopeIn | null);
      if (!scope) invalid({ scope: 'Chọn phạm vi người nhận.' });
      // phạm vi gửi không được rộng hơn phạm vi đã duyệt
      if (n.status === 'approved' && b.scope !== undefined && n.scope && JSON.stringify(normScope(n.scope)) !== JSON.stringify(scope)) {
        fail('PRECONDITION', 'Phạm vi gửi khác với phạm vi đã được duyệt. Hãy gửi duyệt lại.');
      }
      if (n.status !== 'approved' && n.status !== 'scheduled') {
        if (!ctx.can('notify.approve', n.campusId ?? null)) fail('PRECONDITION', 'Thông báo cần được duyệt trước khi gửi.', { status: n.status });
        if (!['draft', 'pending_approval'].includes(n.status)) fail('INVALID_STATE', 'Thông báo không ở trạng thái gửi được.', { status: n.status });
      }
      const requireAck = typeof b.requireAck === 'boolean' ? b.requireAck : !!n.requireAck;
      const at = b.at ? parseWhen(b.at, 'at') : (n.status === 'scheduled' ? null : tsDate(n.scheduledAt));
      if (at && at.getTime() > ctx.now.getTime() + 60_000) {
        await resolveScope(ctx, scope!, true); // kiểm tra quyền sớm
        await updateDoc(ctx, ctx.doc(`notifications/${id}`), {
          status: 'scheduled', scope, requireAck, scheduledAt: Timestamp.fromDate(at), scheduledBy: ctx.uid,
          ...(n.status === 'draft' || n.status === 'pending_approval' ? { approvedBy: ctx.uid, approvedAt: Timestamp.fromDate(ctx.now) } : {}),
        });
        await ctx.audit({ action: 'notification.schedule', collection: 'notifications', docId: id, campusId: n.campusId ?? null, after: { scheduledAt: at.toISOString(), scope } });
        return { id, status: 'scheduled', scheduledAt: at.toISOString() };
      }
      return deliver(ctx, id, scope!, requireAck, true);
    },
  },

  'notification.markRead': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id ?? b.notificationId, 'id');
      const ref = ctx.doc(`notificationReceipts/${id}_${ctx.uid}`);
      const sn = await ref.get();
      if (!sn.exists) fail('NOT_FOUND', 'Thông báo không còn khả dụng với bạn.');
      if (sn.data()!.readAt) return { id, readAt: sn.data()!.readAt, unchanged: true };
      await ref.update({ readAt: Timestamp.fromDate(ctx.now) });
      return { id, readAt: ctx.now.toISOString() };
    },
  },

  'notification.ack': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id ?? b.notificationId, 'id');
      const ref = ctx.doc(`notificationReceipts/${id}_${ctx.uid}`);
      const sn = await ref.get();
      if (!sn.exists) fail('NOT_FOUND', 'Thông báo không còn khả dụng với bạn.');
      if (sn.data()!.requireAck !== true) fail('INVALID_STATE', 'Thông báo này không yêu cầu xác nhận.');
      if (sn.data()!.ackAt) return { id, ackAt: sn.data()!.ackAt, unchanged: true };
      const t = Timestamp.fromDate(ctx.now);
      await ref.update({ ackAt: t, readAt: sn.data()!.readAt ?? t });
      return { id, ackAt: ctx.now.toISOString() };
    },
  },

  // ---------------------------------------------------------------- trao đổi
  'thread.open': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const subject = s(b.subject);
      if (subject.length < 3) invalid({ subject: 'Nhập chủ đề (tối thiểu 3 ký tự).' });
      if (subject.length > 200) invalid({ subject: 'Chủ đề tối đa 200 ký tự.' });
      const priority = s(b.priority) || 'normal';
      if (!(PRIORITIES as readonly string[]).includes(priority)) invalid({ priority: 'Mức ưu tiên không hợp lệ.' });
      const isParent = ctx.member?.kind === 'parent';
      let child: DocumentData & { id: string; campusId: string; classId?: string | null } | null = null;
      let campusId: string;
      let participants: string[] = [];
      if (isParent) {
        const childId = requireId(b.childId, 'childId');
        requireParentOf(ctx, childId);
        child = await childOf(ctx, childId);
        campusId = child.campusId;
        participants = [ctx.uid];
      } else if (s(b.childId)) {
        child = await childOf(ctx, b.childId);
        campusId = child.campusId;
        ctx.require('inbox.handle', campusId);
        participants = [...new Set([...(await parentUidsOfChild(ctx, child.id, 'notify')), ctx.uid])];
      } else if (s(b.classId)) {
        const cls = await getOr404(ctx.doc(`classes/${s(b.classId)}`), 'Lớp học');
        campusId = cls.campusId;
        ctx.require('inbox.handle', campusId);
        participants = [ctx.uid];
      } else invalid({ childId: 'Chọn bé hoặc lớp cho cuộc trao đổi.' });
      const now = Timestamp.fromDate(ctx.now);
      const data = {
        campusId: campusId!, childId: child?.id ?? null, classId: child?.classId ?? (s(b.classId) || null), subject, priority, status: 'open',
        participants, createdBy: ctx.uid, createdByName: ctx.member?.displayName ?? ctx.uid, createdByKind: ctx.member?.kind ?? 'staff',
        assignedTo: null, dueAt: null, lastMessageAt: now, messageCount: 0,
      };
      const id = await createDoc(ctx, 'threads', undefined, data);
      let firstMsg: string | null = null;
      if (s(b.text)) firstMsg = await addMessage(ctx, id, s(b.text), []);
      await ctx.audit({ action: 'thread.open', collection: 'threads', docId: id, campusId: campusId!, after: { subject, childId: child?.id ?? null } });
      if (isParent) { /* nhân viên xem qua hộp thư (inbox.handle) */ } else void pushToUsers(ctx.orgId, participants.filter((u) => u !== ctx.uid), { type: 'thread', threadId: id });
      return { id, ...data, firstMessageId: firstMsg, version: 1 };
    },
  },

  'thread.post': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const threadId = requireId(b.threadId, 'threadId');
      const th = await getOr404(ctx.doc(`threads/${threadId}`), 'Cuộc trao đổi');
      const isParent = ctx.member?.kind === 'parent';
      const participant = (th.participants ?? []).includes(ctx.uid);
      if (isParent) {
        if (!participant || !(ctx.member!.childIds ?? []).includes(th.childId)) denied('Bạn không thuộc cuộc trao đổi này.');
      } else if (!participant && !ctx.can('inbox.handle', th.campusId)) denied('Bạn không có quyền trả lời cuộc trao đổi này.');
      if (th.status === 'closed') fail('INVALID_STATE', 'Cuộc trao đổi đã đóng. Hãy mở cuộc trao đổi mới.');
      const text = s(b.text);
      const paths = asArr<string>(b.attachmentPaths).map(s);
      if (!text && !paths.length) invalid({ text: 'Nhập nội dung tin nhắn.' });
      if (text.length > 4000) invalid({ text: 'Tin nhắn tối đa 4000 ký tự.' });
      checkPaths(ctx, th.campusId, paths);
      const mid = await addMessage(ctx, threadId, text, paths);
      // push chung chung cho phía còn lại
      const targets = isParent ? (th.assignedTo ? [th.assignedTo as string] : []) : (th.participants ?? []).filter((u: string) => u !== ctx.uid);
      void pushToUsers(ctx.orgId, targets, { type: 'thread', threadId });
      return { id: mid, threadId };
    },
  },

  'thread.assign': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const threadId = requireId(b.threadId, 'threadId');
      const th = await getOr404(ctx.doc(`threads/${threadId}`), 'Cuộc trao đổi');
      ctx.require('inbox.handle', th.campusId);
      if (th.status === 'closed') fail('INVALID_STATE', 'Cuộc trao đổi đã đóng.');
      const uid = requireId(b.uid, 'uid');
      const m = await ctx.doc(`members/${uid}`).get();
      if (!m.exists || m.data()!.status !== 'active' || m.data()!.kind === 'parent' || !hasPerm(m.data()!.permsByCampus, 'inbox.handle', th.campusId)) {
        invalid({ uid: 'Người được giao không có quyền xử lý trao đổi tại cơ sở này.' });
      }
      const dueAt = b.dueAt ? Timestamp.fromDate(parseWhen(b.dueAt, 'dueAt')!) : null;
      const patch: Record<string, any> = { assignedTo: uid, assignedToName: m.data()!.displayName, dueAt, assignedBy: ctx.uid };
      if (s(b.priority)) {
        if (!(PRIORITIES as readonly string[]).includes(s(b.priority))) invalid({ priority: 'Mức ưu tiên không hợp lệ.' });
        patch.priority = s(b.priority);
      }
      const { before, after } = await updateDoc(ctx, ctx.doc(`threads/${threadId}`), patch);
      await ctx.audit({ action: 'thread.assign', collection: 'threads', docId: threadId, campusId: th.campusId, before: { assignedTo: before.assignedTo ?? null }, after: { assignedTo: uid } });
      void pushToUsers(ctx.orgId, [uid], { type: 'thread', threadId });
      return { id: threadId, assignedTo: uid, dueAt: dueAt ? dueAt.toDate().toISOString() : null, version: after.version };
    },
  },

  'thread.close': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const threadId = requireId(b.threadId, 'threadId');
      const th = await getOr404(ctx.doc(`threads/${threadId}`), 'Cuộc trao đổi');
      const isParent = ctx.member?.kind === 'parent';
      if (isParent) { if (th.createdBy !== ctx.uid) denied('Chỉ người mở cuộc trao đổi mới đóng được.'); }
      else ctx.require('inbox.handle', th.campusId);
      if (th.status === 'closed') return { id: threadId, status: 'closed', unchanged: true };
      const resolution = s(b.resolution);
      if (!isParent && !resolution) invalid({ resolution: 'Vui lòng ghi kết quả xử lý.' });
      const { after } = await updateDoc(ctx, ctx.doc(`threads/${threadId}`), {
        status: 'closed', resolution: resolution || null, closedBy: ctx.uid, closedAt: Timestamp.fromDate(ctx.now),
      });
      await ctx.audit({ action: 'thread.close', collection: 'threads', docId: threadId, campusId: th.campusId, before: { status: th.status }, after: { status: 'closed' }, reason: resolution || undefined });
      return { id: threadId, status: 'closed', version: after.version };
    },
  },
};

function tsDate(v: unknown): Date | null {
  return v instanceof Timestamp ? v.toDate() : null;
}

async function addMessage(ctx: Ctx, threadId: string, text: string, attachmentPaths: string[]): Promise<string> {
  const ref = ctx.doc(`threads/${threadId}`).collection('messages').doc();
  const now = Timestamp.fromDate(ctx.now);
  const batch = db.batch();
  batch.create(ref, {
    senderUid: ctx.uid, senderName: ctx.member?.displayName ?? ctx.uid, senderKind: ctx.member?.kind ?? 'staff', text, attachmentPaths, at: now,
    createdAt: now, createdBy: ctx.uid,
  });
  batch.update(ctx.doc(`threads/${threadId}`), { lastMessageAt: now, messageCount: FieldValue.increment(1), updatedAt: now, updatedBy: ctx.uid, version: FieldValue.increment(1) });
  await batch.commit();
  return ref.id;
}
