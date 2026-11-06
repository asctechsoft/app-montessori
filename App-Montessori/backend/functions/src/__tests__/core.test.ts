import './env';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDay, buildWorld, call, callFail, db, makeUser, op, today, World } from './helpers';

let w: World;
let childDung = '';
const orgDoc = (p: string) => db.doc(`orgs/${w.orgId}/${p}`);
const count = async (col: string, f: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query = (q) => q) =>
  (await f(db.collection(`orgs/${w.orgId}/${col}`)).get()).size;

describe('Backend BE-1 (emulator)', () => {
  before(async () => { w = await buildWorld(); });

  it('org.listMine trả đủ tổ chức, vai trò và cơ sở', async () => {
    const r = await call(w.lan, 'org.listMine');
    assert.equal(r.orgs.length, 1);
    assert.equal(r.orgs[0].kind, 'staff');
    assert.deepEqual(r.orgs[0].campuses.map((c: any) => c.id), ['CG']);
    const p = await call(w.linh, 'org.listMine');
    assert.equal(p.orgs[0].kind, 'parent');
    assert.deepEqual(p.orgs[0].childIds, [w.childAn]);
  });

  it('AT01: giáo viên cơ sở A không ghi/đọc được cơ sở B, kể cả đổi mã trong request', async () => {
    const day = today();
    // đúng campus B bằng tài khoản giáo viên CG → bị chặn ở router
    let e = await callFail(w.lan, 'attendance.mark', { orgId: w.orgId, campusId: w.TX, opId: op(), payload: { classId: w.tx1, dayKey: day, items: [{ childId: w.childBinh, status: 'present' }] } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    // giữ campus CG nhưng đổi classId sang lớp của TX
    e = await callFail(w.lan, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.tx1, dayKey: day, items: [{ childId: w.childBinh, status: 'present' }] } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    // lớp CG nhưng không được phân công (Chồi 2)
    e = await callFail(w.lan, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.choi2, dayKey: day, items: [{ childId: w.childAn, status: 'present' }] } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    // thao tác theo childId của cơ sở khác
    e = await callFail(w.lan, 'handover.receive', { orgId: w.orgId, opId: op(), payload: { childId: w.childBinh, dayKey: day, droppedBy: 'x' } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    e = await callFail(w.lan, 'child.save', { orgId: w.orgId, payload: { id: w.childBinh, nickname: 'hack' } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    e = await callFail(w.lan, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', data: { campusId: w.TX, code: 'ZZ', name: 'ZZ', capacity: 5 } } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    // org khác / không tồn tại
    e = await callFail(w.lan, 'child.save', { orgId: 'org_khong_ton_tai', payload: { id: w.childAn } });
    assert.equal(e.code, 'PERMISSION_DENIED');
  });

  it('AT02: phụ huynh chỉ thao tác với con được liên kết', async () => {
    const day = addDay(today(), 1);
    let e = await callFail(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childBinh, fromDay: day, toDay: day, reasonId: 'sick' } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    e = await callFail(w.linh, 'thread.open', { orgId: w.orgId, payload: { childId: w.childBinh, subject: 'Hỏi về bé' } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    e = await callFail(w.linh, 'medication.request', { orgId: w.orgId, payload: { childId: w.childBinh, medicineName: 'Paracetamol', dose: '5ml', times: ['10:00'], fromDay: day, toDay: day, instructions: 'Uống sau ăn' } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    // phụ huynh không gọi được action của nhân viên
    e = await callFail(w.linh, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.mam1, dayKey: today(), items: [] } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    const ok = await call(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: day, toDay: day, reasonId: 'sick' } });
    assert.equal(ok.status, 'pending');
    const t = await call(w.linh, 'thread.open', { orgId: w.orgId, payload: { childId: w.childAn, subject: 'Hỏi về bé', text: 'Xin chào cô' } });
    assert.ok(t.id);
  });

  it('AT03: hai giáo viên nhận cùng bé không trùng; trả trẻ chưa nhận bị chặn', async () => {
    const day = today();
    const pre = await callFail(w.lan, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn2, dayKey: day, pickupPersonId: 'pa_x', verification: { method: 'id_check' } } });
    assert.equal(pre.code, 'PRECONDITION');
    assert.equal(pre.details.reason, 'not_received');
    const [a, b] = await Promise.all([
      call(w.lan, 'handover.receive', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, droppedBy: 'Mẹ' } }),
      call(w.mai, 'handover.receive', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, droppedBy: 'Mẹ' } }),
    ]);
    assert.equal([a, b].filter((x) => x.alreadyReceived === false).length, 1);
    assert.equal(await count('handovers', (q) => q.where('childId', '==', w.childAn).where('dayKey', '==', day)), 1);
    assert.equal(await count('attendance', (q) => q.where('childId', '==', w.childAn).where('dayKey', '==', day)), 1);
    // hai giáo viên cùng điểm danh một bé → vẫn một bản ghi
    await Promise.all([w.lan, w.mai].map((u) => call(u, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.mam1, dayKey: day, items: [{ childId: w.childAn2, status: 'present' }] } })));
    assert.equal(await count('attendance', (q) => q.where('childId', '==', w.childAn2).where('dayKey', '==', day)), 1);
    assert.ok((await orgDoc(`attendance/${w.childAn2}_${day}_all`).get()).exists);
  });

  it('AT04: người đón bị thu hồi / hết hạn bị chặn; người đón hợp lệ được trả', async () => {
    const day = today();
    const auths = await db.collection(`orgs/${w.orgId}/pickupAuthorizations`).where('childId', '==', w.childAn).get();
    const guardianAuth = auths.docs.find((d) => d.data().type === 'guardian')!;
    assert.equal(guardianAuth.data().status, 'approved');
    // phụ huynh tạo ủy quyền người đón thay → chờ duyệt → chưa dùng được
    const created = await call(w.linh, 'pickupAuth.save', { orgId: w.orgId, payload: { childId: w.childAn, personName: 'Bà ngoại', relation: 'grandmother', validTo: addDay(day, 5) } });
    assert.equal(created.status, 'pending');
    let e = await callFail(w.lan, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: created.id, verification: { method: 'qr' } } });
    assert.equal(e.details.reason, 'authorization_pending');
    await call(w.principalCG, 'pickupAuth.decide', { orgId: w.orgId, payload: { id: created.id, decision: 'approved' } });
    // thu hồi
    await call(w.linh, 'pickupAuth.revoke', { orgId: w.orgId, payload: { id: created.id, reason: 'Không cần nữa' } });
    e = await callFail(w.lan, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: created.id, verification: { method: 'id_check' } } });
    assert.equal(e.code, 'PRECONDITION');
    assert.equal(e.details.reason, 'authorization_revoked');
    // hết hạn (ghi trực tiếp một ủy quyền đã quá hạn)
    await orgDoc('pickupAuthorizations/pa_expired').set({ childId: w.childAn, campusId: w.CG, personName: 'Chú Tư', status: 'approved', type: 'delegate', validFrom: addDay(day, -10), validTo: addDay(day, -1), version: 1 });
    e = await callFail(w.lan, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: 'pa_expired', verification: { method: 'otp' } } });
    assert.equal(e.details.reason, 'authorization_expired');
    // ủy quyền không tồn tại
    e = await callFail(w.lan, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: 'pa_khong_co', verification: { method: 'otp' } } });
    assert.equal(e.details.reason, 'authorization_not_found');
    // ủy quyền của trẻ khác
    await orgDoc('pickupAuthorizations/pa_other').set({ childId: w.childAn2, campusId: w.CG, personName: 'Cô Út', status: 'approved', type: 'delegate', validFrom: day, validTo: addDay(day, 3), version: 1 });
    e = await callFail(w.lan, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: 'pa_other', verification: { method: 'id_check' } } });
    assert.equal(e.details.reason, 'authorization_wrong_child');
    // người giám hộ hợp lệ → trả được; trả lần hai bị chặn
    const ok = await call(w.lan, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: guardianAuth.id, verification: { method: 'id_check', note: 'Đã đối chiếu CCCD' } } });
    assert.equal(ok.state, 'picked_up');
    assert.equal(ok.pickedBy, w.lan.uid);
    e = await callFail(w.mai, 'handover.pickup', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: guardianAuth.id, verification: { method: 'id_check' } } });
    assert.equal(e.details.reason, 'already_picked_up');
  });

  it('idempotency: gửi lại cùng opId trả đúng kết quả cũ, không ghi lần hai', async () => {
    const id = op();
    const body = { orgId: w.orgId, opId: id, payload: { classId: w.choi2, startDate: today(), child: { fullName: 'Lê Hoàng Dũng', dob: '2022-02-02' }, guardians: [] } };
    const r1 = await call(w.owner, 'lead.enroll', body);
    const r2 = await call(w.owner, 'lead.enroll', body);
    childDung = r1.childId;
    assert.equal(r1.childId, r2.childId);
    assert.equal(await count('children', (q) => q.where('fullName', '==', 'Lê Hoàng Dũng')), 1);
    // cùng opId nhưng khác action → CONFLICT
    const e = await callFail(w.owner, 'transfer.request', { orgId: w.orgId, opId: id, payload: {} });
    assert.equal(e.code, 'CONFLICT');
    // thiếu opId với action idempotent → VALIDATION
    const e2 = await callFail(w.lan, 'handover.receive', { orgId: w.orgId, payload: { childId: w.childAn, dayKey: today(), droppedBy: 'x' } });
    assert.equal(e2.code, 'VALIDATION');
  });

  it('grant hết hạn không còn quyền; sửa/khóa quyền có hiệu lực ngay', async () => {
    const u = await makeUser('tamthoi');
    await call(w.owner, 'member.invite', { orgId: w.orgId, payload: { kind: 'staff', email: u.email, displayName: 'GV tạm', grants: [{ roleId: 'teacher', campusIds: [w.CG], validTo: new Date(Date.now() - 3600_000).toISOString() }] } });
    await call(u, 'invite.claimPending');
    const m = (await orgDoc(`members/${u.uid}`).get()).data()!;
    assert.deepEqual(m.permsByCampus, {});
    const e = await callFail(u, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.mam1, dayKey: today(), items: [] } });
    assert.equal(e.code, 'PERMISSION_DENIED');
    // cấp lại quyền còn hạn
    await call(w.owner, 'member.updateGrants', { orgId: w.orgId, payload: { uid: u.uid, grants: [{ roleId: 'teacher', campusIds: [w.CG], validTo: new Date(Date.now() + 86400_000).toISOString() }] } });
    const m2 = (await orgDoc(`members/${u.uid}`).get()).data()!;
    assert.ok(m2.permsByCampus[w.CG].includes('attendance.write'));
    // hiệu trưởng không tự cấp quyền tài chính vượt quyền của mình
    const e2 = await callFail(w.principalCG, 'member.updateGrants', { orgId: w.orgId, payload: { uid: u.uid, grants: [{ roleId: 'teacher', campusIds: [w.CG], extraPerms: ['refunds.approve'] }] } });
    assert.equal(e2.code, 'PERMISSION_DENIED');
    // khóa thành viên
    await call(w.owner, 'member.setStatus', { orgId: w.orgId, payload: { uid: u.uid, status: 'suspended', reason: 'Nghỉ việc' } });
    const e3 = await callFail(u, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.mam1, dayKey: today(), items: [] } });
    assert.equal(e3.code, 'PERMISSION_DENIED');
  });

  it('sĩ số: lớp đầy → LIMIT kèm gợi ý; xin ngoại lệ → phê duyệt → nhận trẻ', async () => {
    // Mầm 1 đang có 2/2 trẻ
    const body = { orgId: w.orgId, opId: op(), payload: { classId: w.mam1, startDate: today(), child: { fullName: 'Phạm Quang Huy', dob: '2023-01-01' }, guardians: [] } };
    const e = await callFail(w.principalCG, 'lead.enroll', body);
    assert.equal(e.code, 'LIMIT');
    assert.ok(e.details.suggestions.some((s: any) => s.classId === w.choi2));
    const pend = await call(w.principalCG, 'lead.enroll', { ...body, opId: op(), payload: { ...body.payload, requestException: true, exceptionReason: 'Anh em ruột' } });
    assert.equal(pend.status, 'pending_approval');
    // người lập không tự duyệt
    const self = await callFail(w.principalCG, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
    assert.equal(self.code, 'PERMISSION_DENIED');
    // giáo viên không duyệt được
    const t = await callFail(w.lan, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
    assert.equal(t.code, 'PERMISSION_DENIED');
    const done = await call(w.owner, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
    assert.equal(done.status, 'approved');
    assert.ok(done.result.childId);
    // duyệt lần hai idempotent
    const again = await call(w.owner, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
    assert.equal(again.alreadyDecided, true);
    assert.equal(await count('children', (q) => q.where('fullName', '==', 'Phạm Quang Huy')), 1);
    assert.equal((await orgDoc(`classes/${w.mam1}`).get()).data()!.enrolledCount, 3);
  });

  it('điểm danh: chốt → không ghi được → yêu cầu sửa → duyệt, lưu trước/sau/người duyệt', async () => {
    const day = today();
    const r = await call(w.principalCG, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.choi2, dayKey: day, items: [{ childId: childDung, status: 'present' }, { childId: w.childAn, status: 'present' }] } });
    assert.equal(r.saved.length, 1);
    assert.equal(r.rejected.length, 1); // An không thuộc lớp Chồi 2
    const closed = await call(w.principalCG, 'attendance.close', { orgId: w.orgId, campusId: w.CG, payload: { classId: w.choi2, dayKey: day } });
    assert.equal(closed.closed, true);
    const e = await callFail(w.principalCG, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: op(), payload: { classId: w.choi2, dayKey: day, items: [{ childId: childDung, status: 'absent_unexcused' }] } });
    assert.equal(e.code, 'INVALID_STATE');
    const attId = `${childDung}_${day}_all`;
    const corr = await call(w.principalCG, 'attendance.requestCorrection', { orgId: w.orgId, payload: { attendanceId: attId, newValue: { status: 'absent_excused' }, reason: 'Nhầm lẫn' } });
    assert.equal(corr.status, 'pending');
    const self = await callFail(w.principalCG, 'attendance.decideCorrection', { orgId: w.orgId, payload: { id: corr.id, decision: 'approved' } });
    assert.equal(self.code, 'PERMISSION_DENIED');
    const dec = await call(w.owner, 'attendance.decideCorrection', { orgId: w.orgId, payload: { id: corr.id, decision: 'approved' } });
    assert.equal(dec.status, 'approved');
    const att = (await orgDoc(`attendance/${attId}`).get()).data()!;
    assert.equal(att.status, 'absent_excused');
    assert.equal(att.corrections.length, 1);
    assert.equal(att.corrections[0].before.status, 'present');
    assert.equal(att.corrections[0].approvedBy, w.owner.uid);
  });

  it('đơn nghỉ: mealCancelled theo mealCutoff, không tự đổi điểm danh', async () => {
    const day = today();
    await call(w.principalCG, 'campus.update', { campusId: w.CG, orgId: w.orgId, payload: { mealCutoff: '23:59' } });
    const a = await call(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: addDay(day, 8), toDay: addDay(day, 9), reasonId: 'sick' } });
    const d1 = await call(w.lan, 'leave.decide', { orgId: w.orgId, payload: { id: a.id, decision: 'approved' } });
    assert.deepEqual(d1.mealCancelledDays, [addDay(day, 8), addDay(day, 9)]);
    await call(w.principalCG, 'campus.update', { campusId: w.CG, orgId: w.orgId, payload: { mealCutoff: '00:00' } });
    // gửi hôm nay (sau 00:00) xin nghỉ hôm nay + ngày mai: hôm nay quá mốc chốt, ngày mai còn kịp
    const b = await call(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: day, toDay: addDay(day, 0), reasonId: 'family' } });
    const d2 = await call(w.lan, 'leave.decide', { orgId: w.orgId, payload: { id: b.id, decision: 'approved' } });
    assert.deepEqual(d2.mealCancelledDays, []);
    assert.equal(d2.mealCancelled, false);
    // từ chối cần lý do; đơn nghỉ không tạo/đổi điểm danh
    const c = await call(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: addDay(day, 3), toDay: addDay(day, 3), reasonId: 'x' } });
    const bad = await callFail(w.lan, 'leave.decide', { orgId: w.orgId, payload: { id: c.id, decision: 'rejected' } });
    assert.equal(bad.code, 'VALIDATION');
    assert.equal(await count('attendance', (q) => q.where('childId', '==', w.childAn).where('dayKey', '==', addDay(day, 8))), 0);
    const att = (await orgDoc(`attendance/${w.childAn}_${day}_all`).get()).data()!;
    assert.equal(att.status, 'present'); // đơn nghỉ hôm nay không đổi điểm danh thực tế
  });

  it('chuyển cơ sở: cần duyệt cả hai bên, đóng enrollment cũ mở enrollment mới, giữ childId', async () => {
    const eff = addDay(today(), 1);
    const req = await call(w.principalCG, 'transfer.request', { orgId: w.orgId, opId: op(), payload: { childId: w.childAn2, toClassId: w.tx1, effectiveDate: eff, debtHandling: 'stay', depositHandling: 'stay', reason: 'Chuyển nhà' } });
    assert.equal(Object.keys(req.sides).length, 2);
    const r1 = await call(w.owner, 'transfer.decide', { orgId: w.orgId, payload: { id: req.id, decision: 'approved', campusId: w.CG } });
    assert.equal(r1.transferStatus, 'pending');
    assert.equal((await orgDoc(`children/${w.childAn2}`).get()).data()!.campusId, w.CG);
    const r2 = await call(w.principalTX, 'transfer.decide', { orgId: w.orgId, payload: { id: req.id, decision: 'approved' } });
    assert.equal(r2.transferStatus, 'completed');
    const child = (await orgDoc(`children/${w.childAn2}`).get()).data()!;
    assert.equal(child.campusId, w.TX);
    assert.equal(child.classId, w.tx1);
    const enr = (await db.collection(`orgs/${w.orgId}/enrollments`).where('childId', '==', w.childAn2).get()).docs.map((d) => d.data());
    assert.equal(enr.filter((e) => e.status === 'active').length, 1);
    assert.equal(enr.find((e) => e.status === 'ended')!.endDate, today());
    assert.equal(enr.find((e) => e.status === 'active')!.campusId, w.TX);
    // lịch sử điểm danh cũ giữ nguyên tại nơi phát sinh
    assert.equal((await orgDoc(`attendance/${w.childAn2}_${today()}_all`).get()).data()!.campusId, w.CG);
  });

  it('thông báo: duyệt → gửi tới đúng người nhận → đọc/xác nhận', async () => {
    // hiệu trưởng CG không có quyền duyệt thông báo → cần chủ chuỗi duyệt
    await call(w.owner, 'member.updateGrants', { orgId: w.orgId, payload: { uid: w.principalCG.uid, grants: [{ roleId: 'principal', campusIds: [w.CG], deniedPerms: ['notify.approve'] }] } });
    const n = await call(w.principalCG, 'notification.save', { orgId: w.orgId, payload: { campusId: w.CG, title: 'Họp phụ huynh', body: 'Thứ Bảy 8h', scope: { type: 'campus', ids: [w.CG] }, requireAck: true } });
    const sub = await call(w.principalCG, 'notification.submit', { orgId: w.orgId, payload: { id: n.id } });
    assert.equal(sub.status, 'pending_approval');
    const early = await callFail(w.principalCG, 'notification.send', { orgId: w.orgId, payload: { id: n.id } });
    assert.equal(early.code, 'PRECONDITION');
    await call(w.owner, 'notification.approve', { orgId: w.orgId, payload: { id: n.id } });
    const sent = await call(w.principalCG, 'notification.send', { orgId: w.orgId, payload: { id: n.id } });
    assert.equal(sent.status, 'sent');
    const receipts = (await db.collection(`orgs/${w.orgId}/notificationReceipts`).where('notifId', '==', n.id).get()).docs.map((d) => d.data().uid);
    assert.ok(receipts.includes(w.linh.uid));
    assert.ok(!receipts.includes(w.thuy.uid), 'phụ huynh cơ sở khác không nhận');
    assert.ok(!receipts.includes(w.hoa.uid), 'nhân viên cơ sở khác không nhận');
    await call(w.linh, 'notification.markRead', { orgId: w.orgId, payload: { id: n.id } });
    await call(w.linh, 'notification.ack', { orgId: w.orgId, payload: { id: n.id } });
    const rc = (await orgDoc(`notificationReceipts/${n.id}_${w.linh.uid}`).get()).data()!;
    assert.ok(rc.readAt && rc.ackAt);
    const e = await callFail(w.thuy, 'notification.markRead', { orgId: w.orgId, payload: { id: n.id } });
    assert.equal(e.code, 'NOT_FOUND');
    const again = await call(w.principalCG, 'notification.send', { orgId: w.orgId, payload: { id: n.id } });
    assert.equal(again.alreadySent, true);
  });

  it('thuốc/nhật ký: không suy đoán thông tin thiếu; ảnh cần đúng cơ sở + consent', async () => {
    const day = addDay(today(), 1);
    const e = await callFail(w.linh, 'medication.request', { orgId: w.orgId, payload: { childId: w.childAn, medicineName: 'Hạ sốt', times: ['10:00'], fromDay: day, toDay: day, instructions: 'Sau ăn' } });
    assert.equal(e.code, 'VALIDATION');
    assert.ok(e.details.fieldErrors.dose);
    const rq = await call(w.linh, 'medication.request', { orgId: w.orgId, payload: { childId: w.childAn, medicineName: 'Hạ sốt', dose: '5ml', times: ['10:00'], fromDay: today(), toDay: day, instructions: 'Sau ăn' } });
    await call(w.lan, 'medication.decide', { orgId: w.orgId, payload: { id: rq.id, decision: 'received' } });
    const bad = await callFail(w.lan, 'medication.administer', { orgId: w.orgId, payload: { requestId: rq.id, result: 'given' } });
    assert.equal(bad.code, 'VALIDATION');
    const ok = await call(w.lan, 'medication.administer', { orgId: w.orgId, payload: { requestId: rq.id, dose: '5ml', result: 'given' } });
    assert.ok(ok.id);
    const dl = await callFail(w.lan, 'dailyLog.save', { orgId: w.orgId, payload: { childId: w.childAn, dayKey: today(), photoPaths: [`orgs/${w.orgId}/campuses/${w.TX}/x.jpg`] } });
    assert.equal(dl.code, 'VALIDATION');
    const saved = await call(w.lan, 'dailyLog.save', { orgId: w.orgId, payload: { childId: w.childAn, dayKey: today(), mood: 'vui', note: 'Bé ăn tốt', photoPaths: [`orgs/${w.orgId}/campuses/${w.CG}/dailyLogs/${today()}/${w.childAn}/a.jpg`] } });
    assert.equal(saved.status, 'draft');
    const denied = await callFail(w.lan, 'dailyLog.publish', { orgId: w.orgId, payload: { classId: w.mam1, dayKey: today() } });
    assert.equal(denied.code, 'PERMISSION_DENIED');
    const pub = await call(w.principalCG, 'dailyLog.publish', { orgId: w.orgId, payload: { classId: w.mam1, dayKey: today() } });
    assert.deepEqual(pub.published, [w.childAn]);
  });

  it('entity: trùng mã, version conflict, lưu trữ không xóa cứng', async () => {
    const dup = await callFail(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', data: { campusId: w.CG, code: 'M1', name: 'Trùng', capacity: 5 } } });
    assert.equal(dup.code, 'VALIDATION');
    assert.ok(dup.details.fieldErrors.code);
    const vc = await callFail(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', id: w.choi2, expectedVersion: 999, data: { name: 'Chồi 2A' } } });
    assert.equal(vc.code, 'VERSION_CONFLICT');
    const full = await callFail(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', id: w.mam1, data: { capacity: 1 } } });
    assert.equal(full.code, 'VALIDATION');
    const arch = await callFail(w.owner, 'entity.archive', { orgId: w.orgId, payload: { collection: 'classes', id: w.mam1, reason: 'Thử' } });
    assert.equal(arch.code, 'PRECONDITION'); // còn trẻ đang học
    const cat = await call(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'categories', data: { campusId: w.CG, type: 'absence_reason', code: 'sick', name: 'Ốm' } } });
    await call(w.owner, 'entity.archive', { orgId: w.orgId, payload: { collection: 'categories', id: cat.id, reason: 'Không dùng' } });
    assert.equal((await orgDoc(`categories/${cat.id}`).get()).data()!.archived, true);
  });

  it('campus.setStatus: chặn đóng khi còn trẻ đang học, kèm danh sách', async () => {
    const e = await callFail(w.owner, 'campus.setStatus', { orgId: w.orgId, payload: { campusId: w.CG, status: 'closed', reason: 'Thử đóng' } });
    assert.equal(e.code, 'PRECONDITION');
    assert.ok(e.details.blockers.children.length >= 1);
    const ok = await call(w.owner, 'campus.setStatus', { orgId: w.orgId, payload: { campusId: w.CG, status: 'active', reason: 'Khai trương' } });
    assert.equal(ok.status, 'active');
    const sp = await call(w.owner, 'campus.setupProgress', { orgId: w.orgId, payload: { campusId: w.CG } });
    assert.ok(Array.isArray(sp.steps));
  });
});
