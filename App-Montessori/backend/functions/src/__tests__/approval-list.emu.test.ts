// Test emulator: approval.list lọc theo quyền phía máy chủ (approvals.read + requiredPerm tại campus của yêu cầu).
const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT ??= 'app-montessori-36ec6';
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, Timestamp } from '../core/firebase';
import { createRouter } from '../core/router';
import { actions } from '../modules';

describe('approval.list (emulator)', { skip: !EMU }, () => {
  const handle = createRouter(actions);
  const orgId = `t${randomUUID().slice(0, 8)}`;
  const O = (p: string) => db.doc(`orgs/${orgId}/${p}`);
  const who = (uid: string) => ({ uid, token: { email: `${uid}@t.local` } });
  const owner = who('owner'); const prinCG = who('prinCG'); const prinTX = who('prinTX'); const acct = who('acct'); const parent = who('parent'); const lan = who('lan');
  const list = async (c: { uid: string; token: Record<string, unknown> }, payload: unknown = {}) =>
    ((await handle({ auth: c, data: { action: 'approval.list', orgId, payload } } as any)).data as { items: any[] }).items;
  const ids = (a: any[]) => a.map((x) => x.id).sort();

  before(async () => {
    await db.doc(`orgs/${orgId}`).set({ name: 'Org test', status: 'active', ownerUid: 'owner' });
    for (const id of ['CG', 'TX']) await O(`campuses/${id}`).set({ code: id, name: id, status: 'active', timezone: 'Asia/Ho_Chi_Minh', version: 1 });
    const member = (u: { uid: string }, kind: string, grants: any[], extra = {}) => O(`members/${u.uid}`).set({ uid: u.uid, displayName: u.uid, kind, status: 'active', grants, childIds: [], permsByCampus: {}, version: 1, ...extra });
    await member(owner, 'owner', []);
    await member(prinCG, 'staff', [{ id: 'g', roleId: 'principal', campusIds: ['CG'] }]);
    await member(prinTX, 'staff', [{ id: 'g', roleId: 'principal', campusIds: ['TX'] }]);
    await member(acct, 'staff', [{ id: 'g', roleId: 'accountant', campusIds: ['CG'] }]);
    await member(lan, 'staff', [{ id: 'g', roleId: 'teacher', campusIds: ['CG'] }]);
    await member(parent, 'parent', [], { childIds: ['c1'] });
    const mk = (id: string, type: string, campusId: string, requiredPerm: string, extra = {}) =>
      O(`approvals/${id}`).set({ type, campusId, requiredPerm, status: 'pending', summary: id, requestedBy: 'someone', requestedByName: 'X', impact: {}, createdAt: Timestamp.now(), ...extra });
    await mk('payroll_cg', 'payroll_run', 'CG', 'payroll.approve');
    await mk('att_cg', 'attendance_correction', 'CG', 'classes.write');
    await mk('att_tx', 'attendance_correction', 'TX', 'classes.write');
    await mk('lan_own', 'payroll_run', 'CG', 'payroll.approve', { requestedBy: 'lan' });
    await mk('done_cg', 'attendance_correction', 'CG', 'classes.write', { status: 'approved' });
  });

  it('owner thấy mọi yêu cầu đang chờ', async () => {
    assert.deepEqual(ids(await list(owner)), ['att_cg', 'att_tx', 'lan_own', 'payroll_cg']);
  });
  it('hiệu trưởng CG: không thấy payroll_run (thiếu payroll.approve) và không thấy cơ sở TX', async () => {
    const r = await list(prinCG);
    assert.ok(r.some((x) => x.id === 'att_cg'));
    assert.ok(!r.some((x) => x.type === 'payroll_run'));
    assert.ok(!r.some((x) => x.id === 'att_tx'));
  });
  it('hiệu trưởng TX chỉ thấy yêu cầu của TX', async () => {
    assert.deepEqual(ids(await list(prinTX)), ['att_tx']);
  });
  it('người lập luôn thấy yêu cầu của mình; giáo viên không thấy yêu cầu khác', async () => {
    assert.deepEqual(ids(await list(lan)), ['lan_own']);
  });
  it('kế toán không có quyền duyệt chấm công → không thấy', async () => {
    assert.ok(!(await list(acct)).some((x) => x.id === 'att_cg'));
  });
  it('lọc status/type/campusId; kết quả đã serialize (createdAt là chuỗi)', async () => {
    assert.deepEqual(ids(await list(owner, { status: 'approved' })), ['done_cg']);
    assert.deepEqual(ids(await list(owner, { type: 'payroll_run' })), ['lan_own', 'payroll_cg']);
    assert.deepEqual(ids(await list(owner, { campusId: 'TX' })), ['att_tx']);
    const r = await list(owner, { limit: 1 });
    assert.equal(r.length, 1);
    assert.equal(typeof r[0].createdAt, 'string');
  });
  it('phụ huynh không thấy yêu cầu nào; status sai → lỗi', async () => {
    assert.deepEqual(await list(parent).catch(() => []), []);
    await assert.rejects(list(owner, { status: 'zzz' }));
  });
});
