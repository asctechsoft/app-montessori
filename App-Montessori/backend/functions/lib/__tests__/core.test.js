"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./env");
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const helpers_1 = require("./helpers");
let w;
let childDung = '';
const orgDoc = (p) => helpers_1.db.doc(`orgs/${w.orgId}/${p}`);
const count = async (col, f = (q) => q) => (await f(helpers_1.db.collection(`orgs/${w.orgId}/${col}`)).get()).size;
(0, node_test_1.describe)('Backend BE-1 (emulator)', () => {
    (0, node_test_1.before)(async () => { w = await (0, helpers_1.buildWorld)(); });
    (0, node_test_1.it)('org.listMine trả đủ tổ chức, vai trò và cơ sở', async () => {
        const r = await (0, helpers_1.call)(w.lan, 'org.listMine');
        strict_1.default.equal(r.orgs.length, 1);
        strict_1.default.equal(r.orgs[0].kind, 'staff');
        strict_1.default.deepEqual(r.orgs[0].campuses.map((c) => c.id), ['CG']);
        const p = await (0, helpers_1.call)(w.linh, 'org.listMine');
        strict_1.default.equal(p.orgs[0].kind, 'parent');
        strict_1.default.deepEqual(p.orgs[0].childIds, [w.childAn]);
    });
    (0, node_test_1.it)('AT01: giáo viên cơ sở A không ghi/đọc được cơ sở B, kể cả đổi mã trong request', async () => {
        const day = (0, helpers_1.today)();
        // đúng campus B bằng tài khoản giáo viên CG → bị chặn ở router
        let e = await (0, helpers_1.callFail)(w.lan, 'attendance.mark', { orgId: w.orgId, campusId: w.TX, opId: (0, helpers_1.op)(), payload: { classId: w.tx1, dayKey: day, items: [{ childId: w.childBinh, status: 'present' }] } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        // giữ campus CG nhưng đổi classId sang lớp của TX
        e = await (0, helpers_1.callFail)(w.lan, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.tx1, dayKey: day, items: [{ childId: w.childBinh, status: 'present' }] } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        // lớp CG nhưng không được phân công (Chồi 2)
        e = await (0, helpers_1.callFail)(w.lan, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.choi2, dayKey: day, items: [{ childId: w.childAn, status: 'present' }] } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        // thao tác theo childId của cơ sở khác
        e = await (0, helpers_1.callFail)(w.lan, 'handover.receive', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childBinh, dayKey: day, droppedBy: 'x' } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        e = await (0, helpers_1.callFail)(w.lan, 'child.save', { orgId: w.orgId, payload: { id: w.childBinh, nickname: 'hack' } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        e = await (0, helpers_1.callFail)(w.lan, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', data: { campusId: w.TX, code: 'ZZ', name: 'ZZ', capacity: 5 } } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        // org khác / không tồn tại
        e = await (0, helpers_1.callFail)(w.lan, 'child.save', { orgId: 'org_khong_ton_tai', payload: { id: w.childAn } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
    });
    (0, node_test_1.it)('AT02: phụ huynh chỉ thao tác với con được liên kết', async () => {
        const day = (0, helpers_1.addDay)((0, helpers_1.today)(), 1);
        let e = await (0, helpers_1.callFail)(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childBinh, fromDay: day, toDay: day, reasonId: 'sick' } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        e = await (0, helpers_1.callFail)(w.linh, 'thread.open', { orgId: w.orgId, payload: { childId: w.childBinh, subject: 'Hỏi về bé' } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        e = await (0, helpers_1.callFail)(w.linh, 'medication.request', { orgId: w.orgId, payload: { childId: w.childBinh, medicineName: 'Paracetamol', dose: '5ml', times: ['10:00'], fromDay: day, toDay: day, instructions: 'Uống sau ăn' } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        // phụ huynh không gọi được action của nhân viên
        e = await (0, helpers_1.callFail)(w.linh, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.mam1, dayKey: (0, helpers_1.today)(), items: [] } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        const ok = await (0, helpers_1.call)(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: day, toDay: day, reasonId: 'sick' } });
        strict_1.default.equal(ok.status, 'pending');
        const t = await (0, helpers_1.call)(w.linh, 'thread.open', { orgId: w.orgId, payload: { childId: w.childAn, subject: 'Hỏi về bé', text: 'Xin chào cô' } });
        strict_1.default.ok(t.id);
    });
    (0, node_test_1.it)('AT03: hai giáo viên nhận cùng bé không trùng; trả trẻ chưa nhận bị chặn', async () => {
        const day = (0, helpers_1.today)();
        const pre = await (0, helpers_1.callFail)(w.lan, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn2, dayKey: day, pickupPersonId: 'pa_x', verification: { method: 'id_check' } } });
        strict_1.default.equal(pre.code, 'PRECONDITION');
        strict_1.default.equal(pre.details.reason, 'not_received');
        const [a, b] = await Promise.all([
            (0, helpers_1.call)(w.lan, 'handover.receive', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, droppedBy: 'Mẹ' } }),
            (0, helpers_1.call)(w.mai, 'handover.receive', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, droppedBy: 'Mẹ' } }),
        ]);
        strict_1.default.equal([a, b].filter((x) => x.alreadyReceived === false).length, 1);
        strict_1.default.equal(await count('handovers', (q) => q.where('childId', '==', w.childAn).where('dayKey', '==', day)), 1);
        strict_1.default.equal(await count('attendance', (q) => q.where('childId', '==', w.childAn).where('dayKey', '==', day)), 1);
        // hai giáo viên cùng điểm danh một bé → vẫn một bản ghi
        await Promise.all([w.lan, w.mai].map((u) => (0, helpers_1.call)(u, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.mam1, dayKey: day, items: [{ childId: w.childAn2, status: 'present' }] } })));
        strict_1.default.equal(await count('attendance', (q) => q.where('childId', '==', w.childAn2).where('dayKey', '==', day)), 1);
        strict_1.default.ok((await orgDoc(`attendance/${w.childAn2}_${day}_all`).get()).exists);
    });
    (0, node_test_1.it)('AT04: người đón bị thu hồi / hết hạn bị chặn; người đón hợp lệ được trả', async () => {
        const day = (0, helpers_1.today)();
        const auths = await helpers_1.db.collection(`orgs/${w.orgId}/pickupAuthorizations`).where('childId', '==', w.childAn).get();
        const guardianAuth = auths.docs.find((d) => d.data().type === 'guardian');
        strict_1.default.equal(guardianAuth.data().status, 'approved');
        // phụ huynh tạo ủy quyền người đón thay → chờ duyệt → chưa dùng được
        const created = await (0, helpers_1.call)(w.linh, 'pickupAuth.save', { orgId: w.orgId, payload: { childId: w.childAn, personName: 'Bà ngoại', relation: 'grandmother', validTo: (0, helpers_1.addDay)(day, 5) } });
        strict_1.default.equal(created.status, 'pending');
        let e = await (0, helpers_1.callFail)(w.lan, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: created.id, verification: { method: 'qr' } } });
        strict_1.default.equal(e.details.reason, 'authorization_pending');
        await (0, helpers_1.call)(w.principalCG, 'pickupAuth.decide', { orgId: w.orgId, payload: { id: created.id, decision: 'approved' } });
        // thu hồi
        await (0, helpers_1.call)(w.linh, 'pickupAuth.revoke', { orgId: w.orgId, payload: { id: created.id, reason: 'Không cần nữa' } });
        e = await (0, helpers_1.callFail)(w.lan, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: created.id, verification: { method: 'id_check' } } });
        strict_1.default.equal(e.code, 'PRECONDITION');
        strict_1.default.equal(e.details.reason, 'authorization_revoked');
        // hết hạn (ghi trực tiếp một ủy quyền đã quá hạn)
        await orgDoc('pickupAuthorizations/pa_expired').set({ childId: w.childAn, campusId: w.CG, personName: 'Chú Tư', status: 'approved', type: 'delegate', validFrom: (0, helpers_1.addDay)(day, -10), validTo: (0, helpers_1.addDay)(day, -1), version: 1 });
        e = await (0, helpers_1.callFail)(w.lan, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: 'pa_expired', verification: { method: 'otp' } } });
        strict_1.default.equal(e.details.reason, 'authorization_expired');
        // ủy quyền không tồn tại
        e = await (0, helpers_1.callFail)(w.lan, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: 'pa_khong_co', verification: { method: 'otp' } } });
        strict_1.default.equal(e.details.reason, 'authorization_not_found');
        // ủy quyền của trẻ khác
        await orgDoc('pickupAuthorizations/pa_other').set({ childId: w.childAn2, campusId: w.CG, personName: 'Cô Út', status: 'approved', type: 'delegate', validFrom: day, validTo: (0, helpers_1.addDay)(day, 3), version: 1 });
        e = await (0, helpers_1.callFail)(w.lan, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: 'pa_other', verification: { method: 'id_check' } } });
        strict_1.default.equal(e.details.reason, 'authorization_wrong_child');
        // người giám hộ hợp lệ → trả được; trả lần hai bị chặn
        const ok = await (0, helpers_1.call)(w.lan, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: guardianAuth.id, verification: { method: 'id_check', note: 'Đã đối chiếu CCCD' } } });
        strict_1.default.equal(ok.state, 'picked_up');
        strict_1.default.equal(ok.pickedBy, w.lan.uid);
        e = await (0, helpers_1.callFail)(w.mai, 'handover.pickup', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn, dayKey: day, pickupPersonId: guardianAuth.id, verification: { method: 'id_check' } } });
        strict_1.default.equal(e.details.reason, 'already_picked_up');
    });
    (0, node_test_1.it)('idempotency: gửi lại cùng opId trả đúng kết quả cũ, không ghi lần hai', async () => {
        const id = (0, helpers_1.op)();
        const body = { orgId: w.orgId, opId: id, payload: { classId: w.choi2, startDate: (0, helpers_1.today)(), child: { fullName: 'Lê Hoàng Dũng', dob: '2022-02-02' }, guardians: [] } };
        const r1 = await (0, helpers_1.call)(w.owner, 'lead.enroll', body);
        const r2 = await (0, helpers_1.call)(w.owner, 'lead.enroll', body);
        childDung = r1.childId;
        strict_1.default.equal(r1.childId, r2.childId);
        strict_1.default.equal(await count('children', (q) => q.where('fullName', '==', 'Lê Hoàng Dũng')), 1);
        // cùng opId nhưng khác action → CONFLICT
        const e = await (0, helpers_1.callFail)(w.owner, 'transfer.request', { orgId: w.orgId, opId: id, payload: {} });
        strict_1.default.equal(e.code, 'CONFLICT');
        // thiếu opId với action idempotent → VALIDATION
        const e2 = await (0, helpers_1.callFail)(w.lan, 'handover.receive', { orgId: w.orgId, payload: { childId: w.childAn, dayKey: (0, helpers_1.today)(), droppedBy: 'x' } });
        strict_1.default.equal(e2.code, 'VALIDATION');
    });
    (0, node_test_1.it)('grant hết hạn không còn quyền; sửa/khóa quyền có hiệu lực ngay', async () => {
        const u = await (0, helpers_1.makeUser)('tamthoi');
        await (0, helpers_1.call)(w.owner, 'member.invite', { orgId: w.orgId, payload: { kind: 'staff', email: u.email, displayName: 'GV tạm', grants: [{ roleId: 'teacher', campusIds: [w.CG], validTo: new Date(Date.now() - 3600_000).toISOString() }] } });
        await (0, helpers_1.call)(u, 'invite.claimPending');
        const m = (await orgDoc(`members/${u.uid}`).get()).data();
        strict_1.default.deepEqual(m.permsByCampus, {});
        const e = await (0, helpers_1.callFail)(u, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.mam1, dayKey: (0, helpers_1.today)(), items: [] } });
        strict_1.default.equal(e.code, 'PERMISSION_DENIED');
        // cấp lại quyền còn hạn
        await (0, helpers_1.call)(w.owner, 'member.updateGrants', { orgId: w.orgId, payload: { uid: u.uid, grants: [{ roleId: 'teacher', campusIds: [w.CG], validTo: new Date(Date.now() + 86400_000).toISOString() }] } });
        const m2 = (await orgDoc(`members/${u.uid}`).get()).data();
        strict_1.default.ok(m2.permsByCampus[w.CG].includes('attendance.write'));
        // hiệu trưởng không tự cấp quyền tài chính vượt quyền của mình
        const e2 = await (0, helpers_1.callFail)(w.principalCG, 'member.updateGrants', { orgId: w.orgId, payload: { uid: u.uid, grants: [{ roleId: 'teacher', campusIds: [w.CG], extraPerms: ['refunds.approve'] }] } });
        strict_1.default.equal(e2.code, 'PERMISSION_DENIED');
        // khóa thành viên
        await (0, helpers_1.call)(w.owner, 'member.setStatus', { orgId: w.orgId, payload: { uid: u.uid, status: 'suspended', reason: 'Nghỉ việc' } });
        const e3 = await (0, helpers_1.callFail)(u, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.mam1, dayKey: (0, helpers_1.today)(), items: [] } });
        strict_1.default.equal(e3.code, 'PERMISSION_DENIED');
    });
    (0, node_test_1.it)('sĩ số: lớp đầy → LIMIT kèm gợi ý; xin ngoại lệ → phê duyệt → nhận trẻ', async () => {
        // Mầm 1 đang có 2/2 trẻ
        const body = { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { classId: w.mam1, startDate: (0, helpers_1.today)(), child: { fullName: 'Phạm Quang Huy', dob: '2023-01-01' }, guardians: [] } };
        const e = await (0, helpers_1.callFail)(w.principalCG, 'lead.enroll', body);
        strict_1.default.equal(e.code, 'LIMIT');
        strict_1.default.ok(e.details.suggestions.some((s) => s.classId === w.choi2));
        const pend = await (0, helpers_1.call)(w.principalCG, 'lead.enroll', { ...body, opId: (0, helpers_1.op)(), payload: { ...body.payload, requestException: true, exceptionReason: 'Anh em ruột' } });
        strict_1.default.equal(pend.status, 'pending_approval');
        // người lập không tự duyệt
        const self = await (0, helpers_1.callFail)(w.principalCG, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
        strict_1.default.equal(self.code, 'PERMISSION_DENIED');
        // giáo viên không duyệt được
        const t = await (0, helpers_1.callFail)(w.lan, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
        strict_1.default.equal(t.code, 'PERMISSION_DENIED');
        const done = await (0, helpers_1.call)(w.owner, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
        strict_1.default.equal(done.status, 'approved');
        strict_1.default.ok(done.result.childId);
        // duyệt lần hai idempotent
        const again = await (0, helpers_1.call)(w.owner, 'approval.decide', { orgId: w.orgId, payload: { id: pend.approvalId, decision: 'approved' } });
        strict_1.default.equal(again.alreadyDecided, true);
        strict_1.default.equal(await count('children', (q) => q.where('fullName', '==', 'Phạm Quang Huy')), 1);
        strict_1.default.equal((await orgDoc(`classes/${w.mam1}`).get()).data().enrolledCount, 3);
    });
    (0, node_test_1.it)('điểm danh: chốt → không ghi được → yêu cầu sửa → duyệt, lưu trước/sau/người duyệt', async () => {
        const day = (0, helpers_1.today)();
        const r = await (0, helpers_1.call)(w.principalCG, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.choi2, dayKey: day, items: [{ childId: childDung, status: 'present' }, { childId: w.childAn, status: 'present' }] } });
        strict_1.default.equal(r.saved.length, 1);
        strict_1.default.equal(r.rejected.length, 1); // An không thuộc lớp Chồi 2
        const closed = await (0, helpers_1.call)(w.principalCG, 'attendance.close', { orgId: w.orgId, campusId: w.CG, payload: { classId: w.choi2, dayKey: day } });
        strict_1.default.equal(closed.closed, true);
        const e = await (0, helpers_1.callFail)(w.principalCG, 'attendance.mark', { orgId: w.orgId, campusId: w.CG, opId: (0, helpers_1.op)(), payload: { classId: w.choi2, dayKey: day, items: [{ childId: childDung, status: 'absent_unexcused' }] } });
        strict_1.default.equal(e.code, 'INVALID_STATE');
        const attId = `${childDung}_${day}_all`;
        const corr = await (0, helpers_1.call)(w.principalCG, 'attendance.requestCorrection', { orgId: w.orgId, payload: { attendanceId: attId, newValue: { status: 'absent_excused' }, reason: 'Nhầm lẫn' } });
        strict_1.default.equal(corr.status, 'pending');
        const self = await (0, helpers_1.callFail)(w.principalCG, 'attendance.decideCorrection', { orgId: w.orgId, payload: { id: corr.id, decision: 'approved' } });
        strict_1.default.equal(self.code, 'PERMISSION_DENIED');
        const dec = await (0, helpers_1.call)(w.owner, 'attendance.decideCorrection', { orgId: w.orgId, payload: { id: corr.id, decision: 'approved' } });
        strict_1.default.equal(dec.status, 'approved');
        const att = (await orgDoc(`attendance/${attId}`).get()).data();
        strict_1.default.equal(att.status, 'absent_excused');
        strict_1.default.equal(att.corrections.length, 1);
        strict_1.default.equal(att.corrections[0].before.status, 'present');
        strict_1.default.equal(att.corrections[0].approvedBy, w.owner.uid);
    });
    (0, node_test_1.it)('đơn nghỉ: mealCancelled theo mealCutoff, không tự đổi điểm danh', async () => {
        const day = (0, helpers_1.today)();
        await (0, helpers_1.call)(w.principalCG, 'campus.update', { campusId: w.CG, orgId: w.orgId, payload: { mealCutoff: '23:59' } });
        const a = await (0, helpers_1.call)(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: (0, helpers_1.addDay)(day, 8), toDay: (0, helpers_1.addDay)(day, 9), reasonId: 'sick' } });
        const d1 = await (0, helpers_1.call)(w.lan, 'leave.decide', { orgId: w.orgId, payload: { id: a.id, decision: 'approved' } });
        strict_1.default.deepEqual(d1.mealCancelledDays, [(0, helpers_1.addDay)(day, 8), (0, helpers_1.addDay)(day, 9)]);
        await (0, helpers_1.call)(w.principalCG, 'campus.update', { campusId: w.CG, orgId: w.orgId, payload: { mealCutoff: '00:00' } });
        // gửi hôm nay (sau 00:00) xin nghỉ hôm nay + ngày mai: hôm nay quá mốc chốt, ngày mai còn kịp
        const b = await (0, helpers_1.call)(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: day, toDay: (0, helpers_1.addDay)(day, 0), reasonId: 'family' } });
        const d2 = await (0, helpers_1.call)(w.lan, 'leave.decide', { orgId: w.orgId, payload: { id: b.id, decision: 'approved' } });
        strict_1.default.deepEqual(d2.mealCancelledDays, []);
        strict_1.default.equal(d2.mealCancelled, false);
        // từ chối cần lý do; đơn nghỉ không tạo/đổi điểm danh
        const c = await (0, helpers_1.call)(w.linh, 'leave.submit', { orgId: w.orgId, payload: { childId: w.childAn, fromDay: (0, helpers_1.addDay)(day, 3), toDay: (0, helpers_1.addDay)(day, 3), reasonId: 'x' } });
        const bad = await (0, helpers_1.callFail)(w.lan, 'leave.decide', { orgId: w.orgId, payload: { id: c.id, decision: 'rejected' } });
        strict_1.default.equal(bad.code, 'VALIDATION');
        strict_1.default.equal(await count('attendance', (q) => q.where('childId', '==', w.childAn).where('dayKey', '==', (0, helpers_1.addDay)(day, 8))), 0);
        const att = (await orgDoc(`attendance/${w.childAn}_${day}_all`).get()).data();
        strict_1.default.equal(att.status, 'present'); // đơn nghỉ hôm nay không đổi điểm danh thực tế
    });
    (0, node_test_1.it)('chuyển cơ sở: cần duyệt cả hai bên, đóng enrollment cũ mở enrollment mới, giữ childId', async () => {
        const eff = (0, helpers_1.addDay)((0, helpers_1.today)(), 1);
        const req = await (0, helpers_1.call)(w.principalCG, 'transfer.request', { orgId: w.orgId, opId: (0, helpers_1.op)(), payload: { childId: w.childAn2, toClassId: w.tx1, effectiveDate: eff, debtHandling: 'stay', depositHandling: 'stay', reason: 'Chuyển nhà' } });
        strict_1.default.equal(Object.keys(req.sides).length, 2);
        const r1 = await (0, helpers_1.call)(w.owner, 'transfer.decide', { orgId: w.orgId, payload: { id: req.id, decision: 'approved', campusId: w.CG } });
        strict_1.default.equal(r1.transferStatus, 'pending');
        strict_1.default.equal((await orgDoc(`children/${w.childAn2}`).get()).data().campusId, w.CG);
        const r2 = await (0, helpers_1.call)(w.principalTX, 'transfer.decide', { orgId: w.orgId, payload: { id: req.id, decision: 'approved' } });
        strict_1.default.equal(r2.transferStatus, 'completed');
        const child = (await orgDoc(`children/${w.childAn2}`).get()).data();
        strict_1.default.equal(child.campusId, w.TX);
        strict_1.default.equal(child.classId, w.tx1);
        const enr = (await helpers_1.db.collection(`orgs/${w.orgId}/enrollments`).where('childId', '==', w.childAn2).get()).docs.map((d) => d.data());
        strict_1.default.equal(enr.filter((e) => e.status === 'active').length, 1);
        strict_1.default.equal(enr.find((e) => e.status === 'ended').endDate, (0, helpers_1.today)());
        strict_1.default.equal(enr.find((e) => e.status === 'active').campusId, w.TX);
        // lịch sử điểm danh cũ giữ nguyên tại nơi phát sinh
        strict_1.default.equal((await orgDoc(`attendance/${w.childAn2}_${(0, helpers_1.today)()}_all`).get()).data().campusId, w.CG);
    });
    (0, node_test_1.it)('thông báo: duyệt → gửi tới đúng người nhận → đọc/xác nhận', async () => {
        // hiệu trưởng CG không có quyền duyệt thông báo → cần chủ chuỗi duyệt
        await (0, helpers_1.call)(w.owner, 'member.updateGrants', { orgId: w.orgId, payload: { uid: w.principalCG.uid, grants: [{ roleId: 'principal', campusIds: [w.CG], deniedPerms: ['notify.approve'] }] } });
        const n = await (0, helpers_1.call)(w.principalCG, 'notification.save', { orgId: w.orgId, payload: { campusId: w.CG, title: 'Họp phụ huynh', body: 'Thứ Bảy 8h', scope: { type: 'campus', ids: [w.CG] }, requireAck: true } });
        const sub = await (0, helpers_1.call)(w.principalCG, 'notification.submit', { orgId: w.orgId, payload: { id: n.id } });
        strict_1.default.equal(sub.status, 'pending_approval');
        const early = await (0, helpers_1.callFail)(w.principalCG, 'notification.send', { orgId: w.orgId, payload: { id: n.id } });
        strict_1.default.equal(early.code, 'PRECONDITION');
        await (0, helpers_1.call)(w.owner, 'notification.approve', { orgId: w.orgId, payload: { id: n.id } });
        const sent = await (0, helpers_1.call)(w.principalCG, 'notification.send', { orgId: w.orgId, payload: { id: n.id } });
        strict_1.default.equal(sent.status, 'sent');
        const receipts = (await helpers_1.db.collection(`orgs/${w.orgId}/notificationReceipts`).where('notifId', '==', n.id).get()).docs.map((d) => d.data().uid);
        strict_1.default.ok(receipts.includes(w.linh.uid));
        strict_1.default.ok(!receipts.includes(w.thuy.uid), 'phụ huynh cơ sở khác không nhận');
        strict_1.default.ok(!receipts.includes(w.hoa.uid), 'nhân viên cơ sở khác không nhận');
        await (0, helpers_1.call)(w.linh, 'notification.markRead', { orgId: w.orgId, payload: { id: n.id } });
        await (0, helpers_1.call)(w.linh, 'notification.ack', { orgId: w.orgId, payload: { id: n.id } });
        const rc = (await orgDoc(`notificationReceipts/${n.id}_${w.linh.uid}`).get()).data();
        strict_1.default.ok(rc.readAt && rc.ackAt);
        const e = await (0, helpers_1.callFail)(w.thuy, 'notification.markRead', { orgId: w.orgId, payload: { id: n.id } });
        strict_1.default.equal(e.code, 'NOT_FOUND');
        const again = await (0, helpers_1.call)(w.principalCG, 'notification.send', { orgId: w.orgId, payload: { id: n.id } });
        strict_1.default.equal(again.alreadySent, true);
    });
    (0, node_test_1.it)('thuốc/nhật ký: không suy đoán thông tin thiếu; ảnh cần đúng cơ sở + consent', async () => {
        const day = (0, helpers_1.addDay)((0, helpers_1.today)(), 1);
        const e = await (0, helpers_1.callFail)(w.linh, 'medication.request', { orgId: w.orgId, payload: { childId: w.childAn, medicineName: 'Hạ sốt', times: ['10:00'], fromDay: day, toDay: day, instructions: 'Sau ăn' } });
        strict_1.default.equal(e.code, 'VALIDATION');
        strict_1.default.ok(e.details.fieldErrors.dose);
        const rq = await (0, helpers_1.call)(w.linh, 'medication.request', { orgId: w.orgId, payload: { childId: w.childAn, medicineName: 'Hạ sốt', dose: '5ml', times: ['10:00'], fromDay: (0, helpers_1.today)(), toDay: day, instructions: 'Sau ăn' } });
        await (0, helpers_1.call)(w.lan, 'medication.decide', { orgId: w.orgId, payload: { id: rq.id, decision: 'received' } });
        const bad = await (0, helpers_1.callFail)(w.lan, 'medication.administer', { orgId: w.orgId, payload: { requestId: rq.id, result: 'given' } });
        strict_1.default.equal(bad.code, 'VALIDATION');
        const ok = await (0, helpers_1.call)(w.lan, 'medication.administer', { orgId: w.orgId, payload: { requestId: rq.id, dose: '5ml', result: 'given' } });
        strict_1.default.ok(ok.id);
        const dl = await (0, helpers_1.callFail)(w.lan, 'dailyLog.save', { orgId: w.orgId, payload: { childId: w.childAn, dayKey: (0, helpers_1.today)(), photoPaths: [`orgs/${w.orgId}/campuses/${w.TX}/x.jpg`] } });
        strict_1.default.equal(dl.code, 'VALIDATION');
        const saved = await (0, helpers_1.call)(w.lan, 'dailyLog.save', { orgId: w.orgId, payload: { childId: w.childAn, dayKey: (0, helpers_1.today)(), mood: 'vui', note: 'Bé ăn tốt', photoPaths: [`orgs/${w.orgId}/campuses/${w.CG}/dailyLogs/${(0, helpers_1.today)()}/${w.childAn}/a.jpg`] } });
        strict_1.default.equal(saved.status, 'draft');
        const denied = await (0, helpers_1.callFail)(w.lan, 'dailyLog.publish', { orgId: w.orgId, payload: { classId: w.mam1, dayKey: (0, helpers_1.today)() } });
        strict_1.default.equal(denied.code, 'PERMISSION_DENIED');
        const pub = await (0, helpers_1.call)(w.principalCG, 'dailyLog.publish', { orgId: w.orgId, payload: { classId: w.mam1, dayKey: (0, helpers_1.today)() } });
        strict_1.default.deepEqual(pub.published, [w.childAn]);
    });
    (0, node_test_1.it)('entity: trùng mã, version conflict, lưu trữ không xóa cứng', async () => {
        const dup = await (0, helpers_1.callFail)(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', data: { campusId: w.CG, code: 'M1', name: 'Trùng', capacity: 5 } } });
        strict_1.default.equal(dup.code, 'VALIDATION');
        strict_1.default.ok(dup.details.fieldErrors.code);
        const vc = await (0, helpers_1.callFail)(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', id: w.choi2, expectedVersion: 999, data: { name: 'Chồi 2A' } } });
        strict_1.default.equal(vc.code, 'VERSION_CONFLICT');
        const full = await (0, helpers_1.callFail)(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'classes', id: w.mam1, data: { capacity: 1 } } });
        strict_1.default.equal(full.code, 'VALIDATION');
        const arch = await (0, helpers_1.callFail)(w.owner, 'entity.archive', { orgId: w.orgId, payload: { collection: 'classes', id: w.mam1, reason: 'Thử' } });
        strict_1.default.equal(arch.code, 'PRECONDITION'); // còn trẻ đang học
        const cat = await (0, helpers_1.call)(w.owner, 'entity.save', { orgId: w.orgId, payload: { collection: 'categories', data: { campusId: w.CG, type: 'absence_reason', code: 'sick', name: 'Ốm' } } });
        await (0, helpers_1.call)(w.owner, 'entity.archive', { orgId: w.orgId, payload: { collection: 'categories', id: cat.id, reason: 'Không dùng' } });
        strict_1.default.equal((await orgDoc(`categories/${cat.id}`).get()).data().archived, true);
    });
    (0, node_test_1.it)('campus.setStatus: chặn đóng khi còn trẻ đang học, kèm danh sách', async () => {
        const e = await (0, helpers_1.callFail)(w.owner, 'campus.setStatus', { orgId: w.orgId, payload: { campusId: w.CG, status: 'closed', reason: 'Thử đóng' } });
        strict_1.default.equal(e.code, 'PRECONDITION');
        strict_1.default.ok(e.details.blockers.children.length >= 1);
        const ok = await (0, helpers_1.call)(w.owner, 'campus.setStatus', { orgId: w.orgId, payload: { campusId: w.CG, status: 'active', reason: 'Khai trương' } });
        strict_1.default.equal(ok.status, 'active');
        const sp = await (0, helpers_1.call)(w.owner, 'campus.setupProgress', { orgId: w.orgId, payload: { campusId: w.CG } });
        strict_1.default.ok(Array.isArray(sp.steps));
    });
});
