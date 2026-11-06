import './env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

const PROJECT = `rules-${Date.now()}`;
let env: RulesTestEnvironment;

const O1 = 'org1';
const O2 = 'org2';
const perms = (...p: string[]) => p;
const member = (uid: string, kind: string, permsByCampus: Record<string, string[]>, extra: Record<string, unknown> = {}) => ({
  uid, kind, status: 'active', displayName: uid, grants: [], childIds: [], childPerms: {}, permsByCampus,
  permsAny: [...new Set(Object.values(permsByCampus).flat())], ...extra,
});

describe('Firestore rules', () => {
  before(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
    env = await initializeTestEnvironment({
      projectId: PROJECT,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'), host, port: Number(port) },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const put = (p: string, d: Record<string, unknown>) => setDoc(doc(db, p), d);
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

  after(async () => { await env?.cleanup(); });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();

  it('client không ghi được dữ liệu nghiệp vụ (kể cả chủ chuỗi)', async () => {
    for (const uid of ['teacherCG', 'owner1', 'mother']) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, `orgs/${O1}/children/new1`), { campusId: 'CG' }));
      await assertFails(updateDoc(doc(db, `orgs/${O1}/children/kidA`), { fullName: 'X' }));
      await assertFails(addDoc(collection(db, `orgs/${O1}/attendance`), { campusId: 'CG' }));
      await assertFails(setDoc(doc(db, `orgs/${O1}/members/${uid}`), member(uid, 'owner', { '*': ['org.manage'] })));
    }
  });

  it('chỉ ghi được users/{uid} của mình và users/{uid}/devices/*', async () => {
    const db = as('mother');
    await assertSucceeds(setDoc(doc(db, 'users/mother'), { uid: 'mother', displayName: 'Mẹ', locale: 'vi' }));
    await assertSucceeds(setDoc(doc(db, 'users/mother/devices/d1'), { fcmToken: 't', platform: 'android' }));
    await assertFails(setDoc(doc(db, 'users/teacherCG'), { uid: 'teacherCG', displayName: 'Hack' }));
    await assertFails(setDoc(doc(db, 'users/teacherCG/devices/d1'), { fcmToken: 't' }));
    await assertFails(setDoc(doc(db, 'users/mother'), { uid: 'mother', platformAdmin: true }));
  });

  it('người chưa đăng nhập không đọc được gì', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `orgs/${O1}/children/kidA`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}`)));
  });

  it('AT01: giáo viên cơ sở CG không đọc được dữ liệu cơ sở TX', async () => {
    const db = as('teacherCG');
    await assertSucceeds(getDoc(doc(db, `orgs/${O1}/children/kidA`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/children/kidB`)));
    await assertSucceeds(getDocs(query(collection(db, `orgs/${O1}/children`), where('campusId', '==', 'CG'))));
    await assertFails(getDocs(query(collection(db, `orgs/${O1}/children`), where('campusId', '==', 'TX'))));
    await assertFails(getDocs(collection(db, `orgs/${O1}/children`))); // không lọc campus → không chứng minh được phạm vi
    // sức khỏe: giáo viên (không có children.health.read trong dữ liệu mẫu) bị chặn
    await assertFails(getDoc(doc(db, `orgs/${O1}/children/kidA/private/health`)));
    // nhật ký thao tác chỉ cho audit.read
    await assertFails(getDoc(doc(db, `orgs/${O1}/auditLogs/a1`)));
    // idempotency/ops chỉ server
    await assertFails(getDoc(doc(db, `orgs/${O1}/ops/op1`)));
  });

  it('AT02: phụ huynh chỉ đọc con của mình; nhật ký nháp/sự cố bị ẩn', async () => {
    const db = as('mother');
    await assertSucceeds(getDoc(doc(db, `orgs/${O1}/children/kidA`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/children/kidC`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/children/kidB`)));
    await assertSucceeds(getDoc(doc(db, `orgs/${O1}/children/kidA/private/health`)));
    await assertSucceeds(getDoc(doc(db, `orgs/${O1}/dailyLogs/kidA_d1`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/dailyLogs/kidA_d2`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/incidents/inc1`)));
    await assertSucceeds(getDoc(doc(db, `orgs/${O1}/incidents/inc2`)));
    await assertSucceeds(getDoc(doc(db, `orgs/${O1}/attendance/kidA_d1_all`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/attendance/kidC_d1_all`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/auditLogs/a1`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/members/teacherCG`)));
    await assertSucceeds(getDoc(doc(db, `orgs/${O1}/members/mother`)));
  });

  it('học phí: chỉ phụ huynh có quyền viewFees mới đọc được', async () => {
    await assertSucceeds(getDoc(doc(as('mother'), `orgs/${O1}/receivables/r1`)));
    await assertFails(getDoc(doc(as('father'), `orgs/${O1}/receivables/r1`)));
    await assertFails(getDoc(doc(as('teacherCG'), `orgs/${O1}/receivables/r1`)));
    await assertSucceeds(getDoc(doc(as('owner1'), `orgs/${O1}/receivables/r1`)));
  });

  it('cross-org bị chặn', async () => {
    const db = as('outsider');
    await assertFails(getDoc(doc(db, `orgs/${O1}/children/kidA`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}`)));
    await assertFails(getDoc(doc(db, `orgs/${O1}/members/teacherCG`)));
    // chủ chuỗi org1 không đọc được org2
    await assertFails(getDoc(doc(as('owner1'), `orgs/${O2}/members/outsider`)));
  });

  it('collectionGroup members: chỉ đọc bản ghi uid == auth.uid', async () => {
    const db = as('teacherCG');
    await assertSucceeds(getDocs(query(collectionGroup(db, 'members'), where('uid', '==', 'teacherCG'))));
    await assertFails(getDocs(query(collectionGroup(db, 'members'), where('uid', '==', 'mother'))));
    await assertFails(getDocs(collectionGroup(db, 'members')));
  });

  it('BE-2: nhân viên chỉ đọc phiếu lương/công của mình; lương/sổ quỹ theo quyền; phụ huynh chỉ khoản có viewFees', async () => {
    const emp = as('emp1u');
    await assertSucceeds(getDoc(doc(emp, `orgs/${O1}/payslips/ps1`)));
    await assertFails(getDoc(doc(emp, `orgs/${O1}/payslips/ps2`)));
    await assertSucceeds(getDoc(doc(emp, `orgs/${O1}/timesheetDays/td1`)));
    await assertFails(getDoc(doc(emp, `orgs/${O1}/timesheetDays/td2`)));
    await assertFails(getDoc(doc(emp, `orgs/${O1}/salaries/s1`)));
    const hr = as('hrCG');
    await assertSucceeds(getDoc(doc(hr, `orgs/${O1}/payslips/ps2`)));
    await assertSucceeds(getDoc(doc(hr, `orgs/${O1}/timesheetDays/td2`)));
    await assertSucceeds(getDoc(doc(hr, `orgs/${O1}/salaries/s1`)));
    await assertFails(getDoc(doc(hr, `orgs/${O1}/cashLedger/cl1`)));
    await assertSucceeds(getDoc(doc(hr, `orgs/${O1}/alerts/alr1`)));
    await assertFails(getDoc(doc(as('teacherCG'), `orgs/${O1}/alerts/alr1`)));
    await assertSucceeds(getDoc(doc(as('mother'), `orgs/${O1}/credits/cr1`)));
    await assertFails(getDoc(doc(as('father'), `orgs/${O1}/credits/cr1`)));
    await assertFails(getDoc(doc(as('mother'), `orgs/${O1}/allocations/al1`)));
    await assertFails(getDoc(doc(as('mother'), `orgs/${O1}/cashLedger/cl1`)));
    await assertSucceeds(getDoc(doc(as('owner1'), `orgs/${O1}/cashLedger/cl1`)));
    await assertFails(setDoc(doc(emp, `orgs/${O1}/payslips/ps1`), { net: 999 }));
  });

  it('audit.read đọc được nhật ký thao tác', async () => {
    await assertSucceeds(getDoc(doc(as('owner1'), `orgs/${O1}/auditLogs/a1`)));
  });
});
