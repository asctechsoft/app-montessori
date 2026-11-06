"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = exports.Timestamp = exports.FieldValue = void 0;
exports.loadMember = loadMember;
exports.buildCtx = buildCtx;
const node_crypto_1 = require("node:crypto");
const firebase_1 = require("./firebase");
Object.defineProperty(exports, "FieldValue", { enumerable: true, get: function () { return firebase_1.FieldValue; } });
Object.defineProperty(exports, "Timestamp", { enumerable: true, get: function () { return firebase_1.Timestamp; } });
const errors_1 = require("./errors");
Object.defineProperty(exports, "fail", { enumerable: true, get: function () { return errors_1.fail; } });
const permissions_1 = require("./permissions");
/** Tính lại permsByCampus từ grants (không tin cache) — chặn grant hết hạn ngay lập tức. */
async function loadMember(orgId, uid, now) {
    const snap = await firebase_1.db.doc(`orgs/${orgId}/members/${uid}`).get();
    if (!snap.exists)
        return undefined;
    const m = snap.data();
    const rolesSnap = await firebase_1.db.collection(`orgs/${orgId}/roles`).get();
    const custom = {};
    rolesSnap.forEach((r) => { custom[r.id] = r.data().perms ?? []; });
    const campusIds = (await firebase_1.db.collection(`orgs/${orgId}/campuses`).select().get()).docs.map((d) => d.id);
    m.permsByCampus = (0, permissions_1.computePermsByCampus)((m.grants ?? []), custom, now, campusIds);
    if (m.kind === 'owner') {
        m.permsByCampus = (0, permissions_1.computePermsByCampus)([{ id: 'owner', roleId: 'owner', campusIds: ['*'] }], custom, now, campusIds);
    }
    m.childIds ??= [];
    return m;
}
function buildCtx(a, member, platformAdmin) {
    const now = new Date();
    const ts = () => firebase_1.Timestamp.fromDate(now);
    const requestId = (0, node_crypto_1.randomUUID)();
    const orgPath = (p) => `orgs/${a.orgId}/${p}`;
    const active = member?.status === 'active';
    const ctx = {
        uid: a.uid,
        email: a.token.email,
        phone: a.token.phone_number,
        token: a.token,
        platformAdmin,
        orgId: a.orgId,
        campusId: a.campusId,
        member,
        opId: a.opId,
        requestId,
        now,
        db: firebase_1.db,
        col: (p) => firebase_1.db.collection(orgPath(p)),
        doc: (p) => firebase_1.db.doc(orgPath(p)),
        can(perm, campusId) {
            if (platformAdmin)
                return true;
            if (!member || !active)
                return false;
            return (0, permissions_1.hasPerm)(member.permsByCampus, perm, campusId === undefined ? a.campusId : campusId);
        },
        require(perm, campusId) {
            if (!ctx.can(perm, campusId)) {
                void ctx.audit({ action: 'permission.denied', reason: perm, campusId: campusId ?? a.campusId ?? null, result: 'denied' });
                (0, errors_1.denied)();
            }
        },
        campusesFor(perm) {
            if (platformAdmin)
                return ['*'];
            return active ? (0, permissions_1.campusesWithPerm)(member?.permsByCampus, perm) : [];
        },
        allowedClassIds() {
            if (!member || member.kind === 'owner')
                return null;
            const grants = (member.grants ?? []).filter((g) => {
                if (g.validFrom && new Date(g.validFrom) > now)
                    return false;
                if (g.validTo && new Date(g.validTo) < now)
                    return false;
                return g.roleId === 'teacher';
            });
            if (!grants.length)
                return null; // không phải giáo viên → không hạn chế theo lớp
            if (grants.some((g) => !g.classIds || g.classIds.length === 0))
                return null;
            return [...new Set(grants.flatMap((g) => g.classIds ?? []))];
        },
        async audit(e) {
            try {
                await firebase_1.db.collection(orgPath('auditLogs')).add({
                    at: ts(),
                    actorUid: a.uid,
                    actorName: member?.displayName ?? a.token.name ?? a.uid,
                    campusId: e.campusId ?? a.campusId ?? null,
                    action: e.action,
                    collection: e.collection ?? null,
                    docId: e.docId ?? null,
                    before: e.before ?? null,
                    after: e.after ?? null,
                    reason: e.reason ?? null,
                    result: e.result ?? 'ok',
                    requestId,
                });
            }
            catch (err) {
                console.error('audit failed', err);
            }
        },
        metaCreate: () => ({ createdAt: ts(), updatedAt: ts(), createdBy: a.uid, updatedBy: a.uid, version: 1 }),
        metaUpdate: (prev) => ({ updatedAt: ts(), updatedBy: a.uid, version: prev + 1 }),
        tx: (fn) => firebase_1.db.runTransaction(fn),
    };
    return ctx;
}
