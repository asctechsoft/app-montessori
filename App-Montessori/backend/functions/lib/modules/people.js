"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVITE_TTL_DAYS = void 0;
exports.normPerms = normPerms;
exports.findMemberByContact = findMemberByContact;
exports.upsertInvite = upsertInvite;
exports.linkIdFor = linkIdFor;
exports.syncGuardianPickup = syncGuardianPickup;
exports.linkGuardianCore = linkGuardianCore;
exports.unlinkGuardianCore = unlinkGuardianCore;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const util_1 = require("./util");
exports.INVITE_TTL_DAYS = 14;
function normPerms(raw, base = {}) {
    const p = (0, util_1.asObj)(raw);
    return {
        notify: typeof p.notify === 'boolean' ? p.notify : base.notify ?? true,
        viewFees: typeof p.viewFees === 'boolean' ? p.viewFees : base.viewFees ?? false,
        pickup: typeof p.pickup === 'boolean' ? p.pickup : base.pickup ?? false,
    };
}
/** Tìm member (mọi loại) khớp số điện thoại hoặc email đã chuẩn hóa, trừ member đã bị thu hồi. */
async function findMemberByContact(ctx, phone, email) {
    const found = new Map();
    if (phone)
        (await ctx.col('members').where('phone', '==', phone).get()).forEach((d) => found.set(d.id, d.data()));
    if (email)
        (await ctx.col('members').where('email', '==', email).get()).forEach((d) => found.set(d.id, d.data()));
    for (const [uid, m] of found)
        if (m.status !== 'revoked')
            return { ...m, uid };
    return null;
}
/** Tạo (hoặc gộp vào) lời mời đang chờ cùng loại + cùng email/số điện thoại: không tạo lời mời trùng. */
async function upsertInvite(ctx, spec) {
    const email = spec.email || '';
    const phone = spec.phone || '';
    if (!email && !phone)
        (0, errors_1.invalid)({ email: 'Nhập email hoặc số điện thoại.', phone: 'Nhập email hoặc số điện thoại.' });
    const matches = new Map();
    if (phone)
        (await ctx.col('invites').where('phone', '==', phone).get()).forEach((d) => matches.set(d.id, d.data()));
    if (email)
        (await ctx.col('invites').where('email', '==', email).get()).forEach((d) => matches.set(d.id, d.data()));
    const existing = [...matches.entries()].find(([, v]) => v.status === 'pending' && v.kind === spec.kind);
    const expiresAt = firebase_1.Timestamp.fromMillis(ctx.now.getTime() + exports.INVITE_TTL_DAYS * 86400_000);
    if (existing) {
        const [id, cur] = existing;
        const patch = {
            displayName: spec.displayName || cur.displayName,
            ...ctx.metaUpdate(cur.version ?? 1),
        };
        if (email && !cur.email)
            patch.email = email;
        if (phone && !cur.phone)
            patch.phone = phone;
        if (spec.grants)
            patch.grants = spec.grants;
        if (spec.childIds?.length)
            patch.childIds = [...new Set([...(cur.childIds ?? []), ...spec.childIds])];
        if (spec.childPerms)
            patch.childPerms = { ...(cur.childPerms ?? {}), ...spec.childPerms };
        if (spec.guardianLinkIds?.length)
            patch.guardianLinkIds = [...new Set([...(cur.guardianLinkIds ?? []), ...spec.guardianLinkIds])];
        await ctx.doc(`invites/${id}`).update(patch);
        return { id, code: cur.code, merged: true };
    }
    const code = (0, util_1.randomCode)(8);
    const id = await (0, store_1.createDoc)(ctx, 'invites', undefined, {
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
function linkIdFor(childId, phone, email) {
    return `${childId}_${(0, util_1.shortHash)(phone || `e:${email}`)}`;
}
/** Đồng bộ ủy quyền đón tương ứng với người giám hộ có quyền `pickup`. */
async function syncGuardianPickup(ctx, child, linkId, link) {
    const ref = ctx.doc(`pickupAuthorizations/pa_${linkId}`);
    const snap = await ref.get();
    const active = link.status !== 'unlinked' && link.perms?.pickup === true;
    if (active) {
        const data = {
            childId: child.id, campusId: child.campusId, personName: link.name, phone: link.phone || null, relation: link.relation || null,
            type: 'guardian', guardianLinkId: linkId, status: 'approved', validFrom: (0, util_1.todayOf)(ctx), validTo: null,
        };
        if (snap.exists)
            await ref.update({ ...data, revokedAt: null, revokedBy: null, ...ctx.metaUpdate(snap.data().version ?? 1) });
        else
            await ref.create({ ...data, ...ctx.metaCreate(), approvedBy: ctx.uid });
    }
    else if (snap.exists && snap.data().status !== 'revoked') {
        await ref.update({ status: 'revoked', revokedAt: firebase_1.Timestamp.fromDate(ctx.now), revokedBy: ctx.uid, revokeReason: 'Người giám hộ không còn quyền đón', ...ctx.metaUpdate(snap.data().version ?? 1) });
    }
}
/**
 * Liên kết người giám hộ với trẻ. Số điện thoại/email đã có member → liên kết trực tiếp (không tạo trùng);
 * chưa có → tạo/gộp lời mời parent kèm childIds. Quyền notify/viewFees/pickup tách riêng.
 */
async function linkGuardianCore(ctx, child, g0, perms0) {
    const g = (0, util_1.asObj)(g0);
    const name = (0, util_1.s)(g.name);
    const phone = (0, util_1.normPhone)(g.phone);
    const email = (0, util_1.normEmail)(g.email);
    const errs = {};
    if (!name)
        errs['guardian.name'] = 'Bắt buộc nhập họ tên.';
    if (!phone && !email)
        errs['guardian.phone'] = 'Nhập số điện thoại hoặc email.';
    if (Object.keys(errs).length)
        (0, errors_1.invalid)(errs);
    const relation = (0, util_1.s)(g.relation) || 'other';
    const linkId = linkIdFor(child.id, phone, email);
    const linkRef = ctx.doc(`guardianLinks/${linkId}`);
    const prev = await linkRef.get();
    const perms = normPerms(perms0, prev.exists ? prev.data().perms : {});
    const member = await findMemberByContact(ctx, phone, email);
    let uid = null;
    let status = 'invited';
    let inviteId = null;
    let inviteCode = null;
    let warning;
    if (member && member.kind === 'parent') {
        uid = member.uid;
        status = 'linked';
    }
    else if (member) {
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
        uid, status, perms, inviteId, linkedAt: status === 'linked' ? firebase_1.Timestamp.fromDate(ctx.now) : null,
        unlinkedAt: null, unlinkReason: null,
    };
    let link;
    if (prev.exists) {
        await linkRef.update({ ...data, ...ctx.metaUpdate(prev.data().version ?? 1) });
        link = { ...prev.data(), ...data };
    }
    else {
        await (0, store_1.createDoc)(ctx, 'guardianLinks', linkId, data);
        link = data;
    }
    if (uid) {
        await ctx.doc(`members/${uid}`).update({
            childIds: firebase_1.FieldValue.arrayUnion(child.id),
            [`childPerms.${child.id}`]: perms,
            updatedAt: firebase_1.Timestamp.fromDate(ctx.now), updatedBy: ctx.uid, version: firebase_1.FieldValue.increment(1),
        });
    }
    await syncGuardianPickup(ctx, child, linkId, link);
    await ctx.audit({
        action: 'child.linkGuardian', collection: 'guardianLinks', docId: linkId, campusId: child.campusId,
        before: prev.exists ? { perms: prev.data().perms, status: prev.data().status } : null, after: { perms, status, uid },
    });
    return { ...link, id: linkId, inviteCode, warning };
}
async function unlinkGuardianCore(ctx, child, linkId, reason) {
    const linkRef = ctx.doc(`guardianLinks/${linkId}`);
    const snap = await linkRef.get();
    if (!snap.exists || snap.data().childId !== child.id)
        (0, errors_1.fail)('NOT_FOUND', 'Liên kết người giám hộ không tồn tại.');
    const cur = snap.data();
    if (cur.status === 'unlinked')
        return { id: linkId, ...cur, alreadyUnlinked: true };
    const patch = { status: 'unlinked', unlinkedAt: firebase_1.Timestamp.fromDate(ctx.now), unlinkReason: (0, util_1.s)(reason) || null };
    await linkRef.update({ ...patch, ...ctx.metaUpdate(cur.version ?? 1) });
    if (cur.uid) {
        await ctx.doc(`members/${cur.uid}`).update({
            childIds: firebase_1.FieldValue.arrayRemove(child.id),
            [`childPerms.${child.id}`]: firebase_1.FieldValue.delete(),
            updatedAt: firebase_1.Timestamp.fromDate(ctx.now), updatedBy: ctx.uid, version: firebase_1.FieldValue.increment(1),
        }).catch(() => undefined);
    }
    if (cur.inviteId) {
        const invRef = ctx.doc(`invites/${cur.inviteId}`);
        const inv = await invRef.get();
        if (inv.exists && inv.data().status === 'pending') {
            const childIds = (0, util_1.asArr)(inv.data().childIds).filter((c) => c !== child.id);
            const childPerms = { ...(0, util_1.asObj)(inv.data().childPerms) };
            delete childPerms[child.id];
            const guardianLinkIds = (0, util_1.asArr)(inv.data().guardianLinkIds).filter((l) => l !== linkId);
            await invRef.update({ childIds, childPerms, guardianLinkIds, status: childIds.length ? 'pending' : 'revoked', ...ctx.metaUpdate(inv.data().version ?? 1) });
        }
    }
    await syncGuardianPickup(ctx, child, linkId, { ...cur, ...patch });
    await ctx.audit({ action: 'child.unlinkGuardian', collection: 'guardianLinks', docId: linkId, campusId: child.campusId, before: { status: cur.status, uid: cur.uid ?? null }, after: { status: 'unlinked' }, reason: (0, util_1.s)(reason) || undefined });
    return { id: linkId, ...cur, ...patch };
}
