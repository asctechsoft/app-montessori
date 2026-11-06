"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./env");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const rules_unit_testing_1 = require("@firebase/rules-unit-testing");
const firestore_1 = require("firebase/firestore");
const PROJECT = `rules-${Date.now()}`;
let env;
const O1 = 'org1';
const O2 = 'org2';
const perms = (...p) => p;
const member = (uid, kind, permsByCampus, extra = {}) => ({
    uid, kind, status: 'active', displayName: uid, grants: [], childIds: [], childPerms: {}, permsByCampus,
    permsAny: [...new Set(Object.values(permsByCampus).flat())], ...extra,
});
(0, node_test_1.describe)('Firestore rules', () => {
    (0, node_test_1.before)(async () => {
        const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
        env = await (0, rules_unit_testing_1.initializeTestEnvironment)({
            projectId: PROJECT,
            firestore: { rules: (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../../../firestore.rules'), 'utf8'), host, port: Number(port) },
        });
        await env.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            const put = (p, d) => (0, firestore_1.setDoc)((0, firestore_1.doc)(db, p), d);
            await put(`orgs/${O1}`, { name: 'Org 1', status: 'active' });
            await put(`orgs/${O2}`, { name: 'Org 2', status: 'active' });
            const tCG = perms('campus.read', 'children.read', 'attendance.read', 'attendance.write', 'care.read', 'incident.read', 'classes.read', 'notify.read');
            await put(`orgs/${O1}/members/teacherCG`, member('teacherCG', 'staff', { CG: tCG }));
            await put(`orgs/${O1}/members/owner1`, member('owner1', 'owner', { '*': perms('children.read', 'audit.read', 'members.read', 'incident.read', 'attendance.read', 'payments.read', 'campus.read') }));
            await put(`orgs/${O1}/members/mother`, member('mother', 'parent', {}, { childIds: ['kidA'], childPerms: { kidA: { notify: true, viewFees: true, pickup: true } } }));
            await put(`orgs/${O1}/members/father`, member('father', 'parent', {}, { childIds: ['kidA'], childPerms: { kidA: { notify: true, viewFees: false, pickup: false } } }));
            await put(`orgs/${O2}/members/outsider`, member('outsider', 'staff', { '*': perms('children.read') }));
            await put(`orgs/${O1}/children/kidA`, { campusId: 'CG', fullName: 'Bé A', status: 'active' });
            await put(`orgs/${O1}/children/kidB`, { campusId: 'TX', fullName: 'Bé B', status: 'active' });
            await put(`orgs/${O1}/children/kidC`, { campusId: 'CG', fullName: 'Bé C', status: 'active' });
            await put(`orgs/${O1}/children/kidA/private/health`, { campusId: 'CG', allergies: ['tôm'] });
            await put(`orgs/${O1}/dailyLogs/kidA_d1`, { childId: 'kidA', campusId: 'CG', status: 'published' });
            await put(`orgs/${O1}/dailyLogs/kidA_d2`, { childId: 'kidA', campusId: 'CG', status: 'draft' });
            await put(`orgs/${O1}/incidents/inc1`, { childId: 'kidA', campusId: 'CG', restricted: false, shareWithParent: false });
            await put(`orgs/${O1}/incidents/inc2`, { childId: 'kidA', campusId: 'CG', restricted: false, shareWithParent: true });
            await put(`orgs/${O1}/attendance/kidA_d1_all`, { childId: 'kidA', campusId: 'CG', status: 'present' });
            await put(`orgs/${O1}/attendance/kidC_d1_all`, { childId: 'kidC', campusId: 'CG', status: 'present' });
            await put(`orgs/${O1}/receivables/r1`, { childId: 'kidA', campusId: 'CG', amount: 1000 });
            await put(`orgs/${O1}/auditLogs/a1`, { campusId: 'CG', action: 'x' });
            await put(`orgs/${O1}/ops/op1`, { status: 'done' });
            await put(`orgs/${O1}/members/hrCG`, member('hrCG', 'staff', { CG: perms('payroll.read', 'timekeeping.read', 'staff.read', 'campus.read') }));
            await put(`orgs/${O1}/members/emp1u`, member('emp1u', 'staff', { CG: perms('campus.read') }, { employeeId: 'emp1' }));
            await put(`orgs/${O1}/payslips/ps1`, { employeeUid: 'emp1u', campusId: 'CG', net: 1 });
            await put(`orgs/${O1}/payslips/ps2`, { employeeUid: 'other', campusId: 'CG', net: 2 });
            await put(`orgs/${O1}/timesheetDays/td1`, { employeeId: 'emp1', campusId: 'CG', dayKey: 'd1' });
            await put(`orgs/${O1}/timesheetDays/td2`, { employeeId: 'emp2', campusId: 'CG', dayKey: 'd1' });
            await put(`orgs/${O1}/salaries/s1`, { employeeId: 'emp1', campusId: 'CG', base: 1 });
            await put(`orgs/${O1}/credits/cr1`, { childId: 'kidA', campusId: 'CG', amount: 1 });
            await put(`orgs/${O1}/allocations/al1`, { childId: 'kidA', campusId: 'CG', amount: 1 });
            await put(`orgs/${O1}/cashLedger/cl1`, { campusId: 'CG', amount: 1 });
            await put(`orgs/${O1}/alerts/alr1`, { campusId: 'CG', recipientPerm: 'payroll.read' });
            await put(`orgs/${O1}/stockTransfers/st1`, { campusId: 'TX', toCampusId: 'CG' });
        });
    });
    (0, node_test_1.after)(async () => { await env?.cleanup(); });
    const as = (uid) => env.authenticatedContext(uid).firestore();
    (0, node_test_1.it)('client không ghi được dữ liệu nghiệp vụ (kể cả chủ chuỗi)', async () => {
        for (const uid of ['teacherCG', 'owner1', 'mother']) {
            const db = as(uid);
            await (0, rules_unit_testing_1.assertFails)((0, firestore_1.setDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/new1`), { campusId: 'CG' }));
            await (0, rules_unit_testing_1.assertFails)((0, firestore_1.updateDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidA`), { fullName: 'X' }));
            await (0, rules_unit_testing_1.assertFails)((0, firestore_1.addDoc)((0, firestore_1.collection)(db, `orgs/${O1}/attendance`), { campusId: 'CG' }));
            await (0, rules_unit_testing_1.assertFails)((0, firestore_1.setDoc)((0, firestore_1.doc)(db, `orgs/${O1}/members/${uid}`), member(uid, 'owner', { '*': ['org.manage'] })));
        }
    });
    (0, node_test_1.it)('chỉ ghi được users/{uid} của mình và users/{uid}/devices/*', async () => {
        const db = as('mother');
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.setDoc)((0, firestore_1.doc)(db, 'users/mother'), { uid: 'mother', displayName: 'Mẹ', locale: 'vi' }));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.setDoc)((0, firestore_1.doc)(db, 'users/mother/devices/d1'), { fcmToken: 't', platform: 'android' }));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.setDoc)((0, firestore_1.doc)(db, 'users/teacherCG'), { uid: 'teacherCG', displayName: 'Hack' }));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.setDoc)((0, firestore_1.doc)(db, 'users/teacherCG/devices/d1'), { fcmToken: 't' }));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.setDoc)((0, firestore_1.doc)(db, 'users/mother'), { uid: 'mother', platformAdmin: true }));
    });
    (0, node_test_1.it)('người chưa đăng nhập không đọc được gì', async () => {
        const db = env.unauthenticatedContext().firestore();
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidA`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}`)));
    });
    (0, node_test_1.it)('AT01: giáo viên cơ sở CG không đọc được dữ liệu cơ sở TX', async () => {
        const db = as('teacherCG');
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidA`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidB`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDocs)((0, firestore_1.query)((0, firestore_1.collection)(db, `orgs/${O1}/children`), (0, firestore_1.where)('campusId', '==', 'CG'))));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDocs)((0, firestore_1.query)((0, firestore_1.collection)(db, `orgs/${O1}/children`), (0, firestore_1.where)('campusId', '==', 'TX'))));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDocs)((0, firestore_1.collection)(db, `orgs/${O1}/children`))); // không lọc campus → không chứng minh được phạm vi
        // sức khỏe: giáo viên (không có children.health.read trong dữ liệu mẫu) bị chặn
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidA/private/health`)));
        // nhật ký thao tác chỉ cho audit.read
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/auditLogs/a1`)));
        // idempotency/ops chỉ server
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/ops/op1`)));
    });
    (0, node_test_1.it)('AT02: phụ huynh chỉ đọc con của mình; nhật ký nháp/sự cố bị ẩn', async () => {
        const db = as('mother');
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidA`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidC`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidB`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidA/private/health`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/dailyLogs/kidA_d1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/dailyLogs/kidA_d2`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/incidents/inc1`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/incidents/inc2`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/attendance/kidA_d1_all`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/attendance/kidC_d1_all`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/auditLogs/a1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/members/teacherCG`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/members/mother`)));
    });
    (0, node_test_1.it)('học phí: chỉ phụ huynh có quyền viewFees mới đọc được', async () => {
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('mother'), `orgs/${O1}/receivables/r1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('father'), `orgs/${O1}/receivables/r1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('teacherCG'), `orgs/${O1}/receivables/r1`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('owner1'), `orgs/${O1}/receivables/r1`)));
    });
    (0, node_test_1.it)('cross-org bị chặn', async () => {
        const db = as('outsider');
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/children/kidA`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(db, `orgs/${O1}/members/teacherCG`)));
        // chủ chuỗi org1 không đọc được org2
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('owner1'), `orgs/${O2}/members/outsider`)));
    });
    (0, node_test_1.it)('collectionGroup members: chỉ đọc bản ghi uid == auth.uid', async () => {
        const db = as('teacherCG');
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDocs)((0, firestore_1.query)((0, firestore_1.collectionGroup)(db, 'members'), (0, firestore_1.where)('uid', '==', 'teacherCG'))));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDocs)((0, firestore_1.query)((0, firestore_1.collectionGroup)(db, 'members'), (0, firestore_1.where)('uid', '==', 'mother'))));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDocs)((0, firestore_1.collectionGroup)(db, 'members')));
    });
    (0, node_test_1.it)('BE-2: nhân viên chỉ đọc phiếu lương/công của mình; lương/sổ quỹ theo quyền; phụ huynh chỉ khoản có viewFees', async () => {
        const emp = as('emp1u');
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(emp, `orgs/${O1}/payslips/ps1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(emp, `orgs/${O1}/payslips/ps2`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(emp, `orgs/${O1}/timesheetDays/td1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(emp, `orgs/${O1}/timesheetDays/td2`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(emp, `orgs/${O1}/salaries/s1`)));
        const hr = as('hrCG');
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(hr, `orgs/${O1}/payslips/ps2`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(hr, `orgs/${O1}/timesheetDays/td2`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(hr, `orgs/${O1}/salaries/s1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(hr, `orgs/${O1}/cashLedger/cl1`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(hr, `orgs/${O1}/alerts/alr1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('teacherCG'), `orgs/${O1}/alerts/alr1`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('mother'), `orgs/${O1}/credits/cr1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('father'), `orgs/${O1}/credits/cr1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('mother'), `orgs/${O1}/allocations/al1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('mother'), `orgs/${O1}/cashLedger/cl1`)));
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('owner1'), `orgs/${O1}/cashLedger/cl1`)));
        await (0, rules_unit_testing_1.assertFails)((0, firestore_1.setDoc)((0, firestore_1.doc)(emp, `orgs/${O1}/payslips/ps1`), { net: 999 }));
    });
    (0, node_test_1.it)('audit.read đọc được nhật ký thao tác', async () => {
        await (0, rules_unit_testing_1.assertSucceeds)((0, firestore_1.getDoc)((0, firestore_1.doc)(as('owner1'), `orgs/${O1}/auditLogs/a1`)));
    });
});
