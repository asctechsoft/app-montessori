"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Test emulator: approval.list lọc theo quyền phía máy chủ (approvals.read + requiredPerm tại campus của yêu cầu).
const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT ??= 'app-montessori-36ec6';
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const firebase_1 = require("../core/firebase");
const router_1 = require("../core/router");
const modules_1 = require("../modules");
(0, node_test_1.describe)('approval.list (emulator)', { skip: !EMU }, () => {
    const handle = (0, router_1.createRouter)(modules_1.actions);
    const orgId = `t${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    const O = (p) => firebase_1.db.doc(`orgs/${orgId}/${p}`);
    const who = (uid) => ({ uid, token: { email: `${uid}@t.local` } });
    const owner = who('owner');
    const prinCG = who('prinCG');
    const prinTX = who('prinTX');
    const acct = who('acct');
    const parent = who('parent');
    const lan = who('lan');
    const list = async (c, payload = {}) => (await handle({ auth: c, data: { action: 'approval.list', orgId, payload } })).data.items;
    const ids = (a) => a.map((x) => x.id).sort();
    (0, node_test_1.before)(async () => {
        await firebase_1.db.doc(`orgs/${orgId}`).set({ name: 'Org test', status: 'active', ownerUid: 'owner' });
        for (const id of ['CG', 'TX'])
            await O(`campuses/${id}`).set({ code: id, name: id, status: 'active', timezone: 'Asia/Ho_Chi_Minh', version: 1 });
        const member = (u, kind, grants, extra = {}) => O(`members/${u.uid}`).set({ uid: u.uid, displayName: u.uid, kind, status: 'active', grants, childIds: [], permsByCampus: {}, version: 1, ...extra });
        await member(owner, 'owner', []);
        await member(prinCG, 'staff', [{ id: 'g', roleId: 'principal', campusIds: ['CG'] }]);
        await member(prinTX, 'staff', [{ id: 'g', roleId: 'principal', campusIds: ['TX'] }]);
        await member(acct, 'staff', [{ id: 'g', roleId: 'accountant', campusIds: ['CG'] }]);
        await member(lan, 'staff', [{ id: 'g', roleId: 'teacher', campusIds: ['CG'] }]);
        await member(parent, 'parent', [], { childIds: ['c1'] });
        const mk = (id, type, campusId, requiredPerm, extra = {}) => O(`approvals/${id}`).set({ type, campusId, requiredPerm, status: 'pending', summary: id, requestedBy: 'someone', requestedByName: 'X', impact: {}, createdAt: firebase_1.Timestamp.now(), ...extra });
        await mk('payroll_cg', 'payroll_run', 'CG', 'payroll.approve');
        await mk('att_cg', 'attendance_correction', 'CG', 'classes.write');
        await mk('att_tx', 'attendance_correction', 'TX', 'classes.write');
        await mk('lan_own', 'payroll_run', 'CG', 'payroll.approve', { requestedBy: 'lan' });
        await mk('done_cg', 'attendance_correction', 'CG', 'classes.write', { status: 'approved' });
    });
    (0, node_test_1.it)('owner thấy mọi yêu cầu đang chờ', async () => {
        strict_1.default.deepEqual(ids(await list(owner)), ['att_cg', 'att_tx', 'lan_own', 'payroll_cg']);
    });
    (0, node_test_1.it)('hiệu trưởng CG: không thấy payroll_run (thiếu payroll.approve) và không thấy cơ sở TX', async () => {
        const r = await list(prinCG);
        strict_1.default.ok(r.some((x) => x.id === 'att_cg'));
        strict_1.default.ok(!r.some((x) => x.type === 'payroll_run'));
        strict_1.default.ok(!r.some((x) => x.id === 'att_tx'));
    });
    (0, node_test_1.it)('hiệu trưởng TX chỉ thấy yêu cầu của TX', async () => {
        strict_1.default.deepEqual(ids(await list(prinTX)), ['att_tx']);
    });
    (0, node_test_1.it)('người lập luôn thấy yêu cầu của mình; giáo viên không thấy yêu cầu khác', async () => {
        strict_1.default.deepEqual(ids(await list(lan)), ['lan_own']);
    });
    (0, node_test_1.it)('kế toán không có quyền duyệt chấm công → không thấy', async () => {
        strict_1.default.ok(!(await list(acct)).some((x) => x.id === 'att_cg'));
    });
    (0, node_test_1.it)('lọc status/type/campusId; kết quả đã serialize (createdAt là chuỗi)', async () => {
        strict_1.default.deepEqual(ids(await list(owner, { status: 'approved' })), ['done_cg']);
        strict_1.default.deepEqual(ids(await list(owner, { type: 'payroll_run' })), ['lan_own', 'payroll_cg']);
        strict_1.default.deepEqual(ids(await list(owner, { campusId: 'TX' })), ['att_tx']);
        const r = await list(owner, { limit: 1 });
        strict_1.default.equal(r.length, 1);
        strict_1.default.equal(typeof r[0].createdAt, 'string');
    });
    (0, node_test_1.it)('phụ huynh không thấy yêu cầu nào; status sai → lỗi', async () => {
        strict_1.default.deepEqual(await list(parent).catch(() => []), []);
        await strict_1.default.rejects(list(owner, { status: 'zzz' }));
    });
});
