"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = createRouter;
const firebase_1 = require("./firebase");
const context_1 = require("./context");
const errors_1 = require("./errors");
const store_1 = require("./store");
const OP_PENDING_MS = 60_000;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function createRouter(actions) {
    return async function handle(req) {
        const body = req.data ?? {};
        if (!req.auth)
            (0, errors_1.fail)('UNAUTHENTICATED', 'Vui lòng đăng nhập.');
        const uid = req.auth.uid;
        const token = req.auth.token;
        const name = String(body.action ?? '');
        const def = Object.prototype.hasOwnProperty.call(actions, name) ? actions[name] : undefined;
        if (!def)
            (0, errors_1.fail)('NOT_FOUND', `Thao tác không tồn tại: ${name}`);
        const platformAdmin = token.platformAdmin === true;
        const opId = typeof body.opId === 'string' ? body.opId : undefined;
        if (opId && !ID_RE.test(opId))
            (0, errors_1.fail)('VALIDATION', 'Mã thao tác (opId) không hợp lệ.');
        if (def.idempotent && !opId)
            (0, errors_1.fail)('VALIDATION', 'Thiếu mã thao tác (opId) để chống gửi trùng.', { fieldErrors: { opId: 'Bắt buộc.' } });
        let orgId = '';
        let campusId;
        let member;
        if (def.scope !== 'none') {
            orgId = String(body.orgId ?? '');
            if (!ID_RE.test(orgId))
                (0, errors_1.fail)('VALIDATION', 'Thiếu mã tổ chức.', { fieldErrors: { orgId: 'Bắt buộc.' } });
            const orgSnap = await firebase_1.db.doc(`orgs/${orgId}`).get();
            if (!orgSnap.exists)
                (0, errors_1.fail)('PERMISSION_DENIED', 'Bạn không có quyền truy cập tổ chức này.'); // không lộ tồn tại
            if (orgSnap.data()?.status === 'suspended' && !platformAdmin)
                (0, errors_1.fail)('PRECONDITION', 'Tổ chức đang tạm ngừng.');
            member = await (0, context_1.loadMember)(orgId, uid, new Date());
            if (!platformAdmin && (!member || member.status !== 'active'))
                (0, errors_1.denied)('Bạn không có quyền truy cập tổ chức này.');
            const kinds = def.kinds ?? ['owner', 'staff'];
            if (!platformAdmin && member && !kinds.includes(member.kind))
                (0, errors_1.denied)();
            if (def.scope === 'campus') {
                campusId = String(body.campusId ?? '');
                if (!ID_RE.test(campusId))
                    (0, errors_1.fail)('VALIDATION', 'Thiếu mã cơ sở.', { fieldErrors: { campusId: 'Bắt buộc.' } });
                const c = await firebase_1.db.doc(`orgs/${orgId}/campuses/${campusId}`).get();
                if (!c.exists)
                    (0, errors_1.fail)('PERMISSION_DENIED', 'Bạn không có quyền truy cập cơ sở này.');
            }
            else if (typeof body.campusId === 'string' && ID_RE.test(body.campusId)) {
                campusId = body.campusId;
            }
        }
        const ctx = (0, context_1.buildCtx)({ uid, token, orgId, campusId, opId, loadMember: false }, member, platformAdmin);
        if (def.perm) {
            if (def.scope === 'campus')
                ctx.require(def.perm, campusId);
            else if (!ctx.can(def.perm, campusId) && ctx.campusesFor(def.perm).length === 0)
                ctx.require(def.perm, campusId);
        }
        const run = async () => {
            try {
                return (0, store_1.serialize)(await def.handler(ctx, body.payload ?? {}));
            }
            catch (e) {
                if (e?.httpErrorCode)
                    throw e; // HttpsError đã chuẩn hóa
                console.error(`[api:${name}]`, ctx.requestId, e);
                await ctx.audit({ action: name, result: 'error', reason: String(e?.message ?? e).slice(0, 300) });
                (0, errors_1.fail)('INTERNAL', 'Hệ thống gặp lỗi. Vui lòng thử lại.', { requestId: ctx.requestId });
            }
        };
        if (!def.idempotent || !orgId || !opId)
            return { ok: true, data: await run() };
        // Idempotency: orgs/{org}/ops/{opId}
        const ref = firebase_1.db.doc(`orgs/${orgId}/ops/${opId}`);
        const now = firebase_1.Timestamp.now();
        try {
            await ref.create({ action: name, uid, status: 'pending', startedAt: now });
        }
        catch {
            const s = await ref.get();
            const d = s.data() ?? {};
            if (d.uid !== uid || d.action !== name)
                (0, errors_1.fail)('CONFLICT', 'Mã thao tác đã được dùng cho yêu cầu khác.');
            if (d.status === 'done')
                return { ok: true, data: d.result ?? null };
            const age = Date.now() - (d.startedAt?.toMillis() ?? 0);
            if (d.status === 'pending' && age < OP_PENDING_MS)
                (0, errors_1.fail)('CONFLICT', 'Thao tác đang được xử lý.');
            await ref.set({ action: name, uid, status: 'pending', startedAt: now });
        }
        try {
            const data = await run();
            await ref.set({ action: name, uid, status: 'done', startedAt: now, finishedAt: firebase_1.Timestamp.now(), result: data ?? null });
            return { ok: true, data };
        }
        catch (e) {
            await ref.delete().catch(() => undefined); // cho phép thử lại an toàn
            throw e;
        }
    };
}
