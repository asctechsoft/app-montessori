"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Test emulator Firestore cho phần BE-2: idempotency payment.record, bank.import trùng, AT05–AT07 cốt lõi.
// Chạy: firebase emulators:exec --only firestore "npm test" (tự bỏ qua nếu không có emulator).
// Chỉ chạy khi có FIRESTORE_EMULATOR_HOST (firebase emulators:exec đặt sẵn); nếu không thì bỏ qua.
const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT ??= 'app-montessori-36ec6';
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const firebase_1 = require("../core/firebase");
const router_1 = require("../core/router");
const modules_1 = require("../modules");
const time_1 = require("../lib/time");
(0, node_test_1.describe)('BE-2 emulator (AT05–AT07, idempotency, bank.import)', { skip: !EMU }, () => {
    const handle = (0, router_1.createRouter)(modules_1.actions);
    const orgId = `t${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    const O = (p) => firebase_1.db.doc(`orgs/${orgId}/${p}`);
    const C = (p) => firebase_1.db.collection(`orgs/${orgId}/${p}`);
    const op = () => (0, node_crypto_1.randomUUID)();
    const who = (uid) => ({ uid, token: { email: `${uid}@t.local` } });
    const owner = who('owner');
    const acct = who('acct');
    const hr = who('hr');
    const kitchen = who('kitchen');
    const parent = who('parent');
    const empA = who('empA');
    const principalTX = who('prinTX');
    const now = new Date();
    const todayVN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
    async function call(c, action, payload = {}, extra = {}) {
        const res = await handle({ auth: { uid: c.uid, token: c.token }, data: { action, orgId, payload, ...extra } });
        return res.data;
    }
    async function fails(c, action, payload, expectCode, extra = {}) {
        try {
            await call(c, action, payload, extra);
        }
        catch (e) {
            strict_1.default.ok(e?.httpErrorCode, `lỗi không chuẩn: ${e?.stack ?? e}`);
            strict_1.default.equal(e.details?.code, expectCode, `${action}: ${e.message}`);
            return e;
        }
        strict_1.default.fail(`${action} lẽ ra phải lỗi ${expectCode}`);
    }
    const member = async (u, kind, grants, extra = {}) => {
        await O(`members/${u.uid}`).set({ uid: u.uid, displayName: u.uid, kind, status: 'active', grants, childIds: [], permsByCampus: {}, version: 1, ...extra });
    };
    const PREV = (0, time_1.prevPeriodKey)(todayVN.slice(0, 7)); // kỳ đã kết thúc để khóa công
    const NEXT_MONTH_KEY = todayVN.slice(0, 7);
    (0, node_test_1.before)(async () => {
        await firebase_1.db.doc(`orgs/${orgId}`).set({ name: 'Org test BE-2', status: 'active', ownerUid: 'owner' });
        for (const [id, name] of [['CG', 'Cầu Giấy'], ['TX', 'Thanh Xuân']]) {
            await O(`campuses/${id}`).set({ code: id, name, status: 'active', timezone: 'Asia/Ho_Chi_Minh', mealCutoff: '08:00', closeTime: '17:30', openTime: '07:00', version: 1 });
        }
        await member(owner, 'owner', []);
        await member(acct, 'staff', [{ id: 'g', roleId: 'accountant', campusIds: ['CG'] }]);
        await member(hr, 'staff', [{ id: 'g', roleId: 'hr', campusIds: ['CG', 'TX'] }]);
        await member(kitchen, 'staff', [{ id: 'g', roleId: 'kitchen', campusIds: ['CG'] }]);
        await member(parent, 'parent', [], { childIds: ['c1'] });
        await member(empA, 'staff', [{ id: 'g', roleId: 'teacher', campusIds: ['CG'] }], { employeeId: 'eA' });
        await member(principalTX, 'staff', [{ id: 'g', roleId: 'principal', campusIds: ['TX'] }]);
        await O('classes/cls1').set({ campusId: 'CG', name: 'Mầm 1', code: 'M1', capacity: 20, status: 'active' });
        for (const [id, code, name] of [['c1', 'MN001', 'Nguyễn Minh An'], ['c2', 'MN002', 'Nguyễn Gia Bình']]) {
            await O(`children/${id}`).set({ campusId: 'CG', classId: 'cls1', code, fullName: name, status: 'active', dob: '2023-05-12', enrolledAt: '2026-01-05', version: 1 });
        }
    });
    // ============================================================ AT06 — thu tiền
    (0, node_test_1.describe)('AT06: công nợ, thanh toán một phần/dư, trùng, hủy', () => {
        const periodOld = '2026-09';
        const periodNew = '2026-10';
        let runId = '';
        let payId = '';
        (0, node_test_1.before)(async () => {
            await O('feePolicies/fp1').set({
                campusId: 'CG', name: 'Biểu phí 2026', status: 'published', seriesId: 'fp1', versionNo: 1, effectiveFrom: '2026-01-01',
                items: [{ code: 'HP', type: 'tuition', name: 'Học phí tháng', amount: 3_000_000 }], meal: { unitPrice: 35_000, mode: 'provisional', daysPerMonth: 22 },
                discounts: [{ code: 'GIAM', name: 'Giảm học phí', amount: 300_000 }], dueDay: 10, version: 1,
            });
            // nợ cũ 500.000 (kỳ 09) đã phát hành; 2 suất ăn kỳ 09 đã hủy đủ điều kiện hoàn
            await O(`receivables/rcv_c1_${periodOld}_monthly`).set({
                childId: 'c1', childName: 'Nguyễn Minh An', campusId: 'CG', classId: 'cls1', periodKey: periodOld, type: 'monthly', lines: [], billed: 500_000, discount: 0, adjustUp: 0, openingDebt: 0,
                allocated: 0, balance: 500_000, amount: 500_000, dueDate: '2026-09-10', status: 'overdue', mealMode: 'provisional', version: 1,
            });
            for (const d of ['2026-09-07', '2026-09-08'])
                await O(`mealOrders/c1_${d}`).set({ childId: 'c1', campusId: 'CG', dayKey: d, expected: true, locked: true, billable: false, cancelled: true, served: null, version: 1 });
        });
        (0, node_test_1.it)('billing.preview: phải thu mới 3.600.000, nợ cũ 500.000, tổng 4.100.000 (không cộng hai lần)', async () => {
            const r = await call(acct, 'billing.preview', { campusId: 'CG', periodKey: periodNew, childIds: ['c1'], extras: [{ childId: 'c1', code: 'DONMUON', type: 'service', description: 'Đón muộn', amount: 200_000 }] });
            strict_1.default.equal(r.rows.length, 1);
            const row = r.rows[0];
            strict_1.default.deepEqual(row.errors, []);
            strict_1.default.equal(row.net, 3_600_000);
            strict_1.default.equal(row.openingDebt, 500_000);
            strict_1.default.equal(row.totalDue, 4_100_000);
            strict_1.default.equal(row.refundMealCount, 2);
            strict_1.default.equal(row.mealCount, 22);
        });
        (0, node_test_1.it)('billing.run tạo receivable draft theo id xác định; chạy lại không tạo trùng', async () => {
            const body = { campusId: 'CG', periodKey: periodNew, childIds: ['c1'], extras: [{ childId: 'c1', code: 'DONMUON', type: 'service', description: 'Đón muộn', amount: 200_000 }] };
            const a = await call(acct, 'billing.run', body);
            runId = a.runId;
            strict_1.default.equal(a.created, 1);
            const b = await call(acct, 'billing.run', body);
            strict_1.default.equal(b.created, 0);
            strict_1.default.equal(b.updated, 1);
            const all = await C('receivables').where('periodKey', '==', periodNew).get();
            strict_1.default.equal(all.size, 1);
            strict_1.default.equal(all.docs[0].id, `rcv_c1_${periodNew}_monthly`);
            strict_1.default.equal(all.docs[0].data().status, 'draft');
            strict_1.default.equal(all.docs[0].data().balance, 3_600_000);
        });
        (0, node_test_1.it)('chỉ người có billing.approve duyệt; người lập chỉ gửi yêu cầu; publish chỉ sau duyệt', async () => {
            await fails(acct, 'billing.publish', { runId }, 'INVALID_STATE');
            const sub = await call(acct, 'billing.approve', { runId });
            strict_1.default.equal(sub.status, 'submitted');
            await fails(acct, 'approval.decide', { id: sub.approvalId, decision: 'approved' }, 'PERMISSION_DENIED');
            await call(owner, 'approval.decide', { id: sub.approvalId, decision: 'approved' });
            const pub = await call(acct, 'billing.publish', { runId });
            strict_1.default.equal(pub.issued, 1);
            strict_1.default.equal((await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data().status, 'overdue'); // hạn 10/10 đã qua → phát hành là quá hạn (tính từ dueDate)
        });
        (0, node_test_1.it)('payment.record 2.000.000 → 500.000 nợ cũ + 1.500.000 kỳ mới → còn 2.100.000; idempotent theo opId', async () => {
            const opId = op();
            const r1 = await call(acct, 'payment.record', { childId: 'c1', amount: 2_000_000, channel: 'cash' }, { opId });
            payId = r1.paymentId;
            const m = Object.fromEntries(r1.allocations.map((a) => [a.receivableId, a.amount]));
            strict_1.default.equal(m[`rcv_c1_${periodOld}_monthly`], 500_000);
            strict_1.default.equal(m[`rcv_c1_${periodNew}_monthly`], 1_500_000);
            strict_1.default.equal(r1.debtAfter, 2_100_000);
            const r2 = await call(acct, 'payment.record', { childId: 'c1', amount: 2_000_000, channel: 'cash' }, { opId }); // gửi lại cùng opId
            strict_1.default.deepEqual(r2, r1);
            const pays = await C('payments').where('childId', '==', 'c1').where('type', '==', 'receipt').get();
            strict_1.default.equal(pays.size, 1);
            const nw = (await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data();
            strict_1.default.equal(nw.allocated, 1_500_000);
            strict_1.default.equal(nw.balance, 2_100_000);
            strict_1.default.equal(nw.status, 'partially_paid');
            strict_1.default.equal((await O(`receivables/rcv_c1_${periodOld}_monthly`).get()).data().status, 'paid');
            await fails(acct, 'payment.record', { childId: 'c1', amount: 1000, channel: 'cash' }, 'VALIDATION', { opId: undefined });
        });
        (0, node_test_1.it)('bank.import: giao dịch trùng nguồn+mã bị bỏ qua, KHÔNG ghi thu lần hai', async () => {
            const row = { source: 'vcb', txnCode: 'FT0001', amount: 100_000, at: new Date().toISOString(), content: 'MN001 hoc phi thang 10', account: '0123' };
            const r1 = await call(acct, 'bank.import', { campusId: 'CG', rows: [row] });
            strict_1.default.equal(r1.matched, 1);
            const r2 = await call(acct, 'bank.import', { campusId: 'CG', rows: [row, row] });
            strict_1.default.equal(r2.duplicate, 2);
            strict_1.default.equal(r2.matched, 0);
            const pays = await C('payments').where('reference', '==', 'FT0001').get();
            strict_1.default.equal(pays.size, 1);
            strict_1.default.equal((await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data().allocated, 1_600_000);
            // nhập tay cùng nguồn+mã cũng bị chặn
            await fails(acct, 'payment.record', { childId: 'c1', amount: 100_000, channel: 'bank_transfer', source: 'vcb', reference: 'FT0001' }, 'CONFLICT', { opId: op() });
        });
        (0, node_test_1.it)('bank.import không rõ học sinh → chờ đối soát, không ghi thu; đối soát gán đúng trẻ', async () => {
            const r = await call(acct, 'bank.import', { campusId: 'CG', rows: [{ source: 'vcb', txnCode: 'FT0002', amount: 50_000, at: new Date().toISOString(), content: 'chuyen tien', account: '0123' }] });
            strict_1.default.equal(r.unmatched, 1);
            strict_1.default.equal((await C('payments').where('reference', '==', 'FT0002').get()).size, 0);
            const before = (await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data().allocated;
            const rec = await call(acct, 'payment.reconcile', { bankTxnId: 'vcb_FT0002', childId: 'c1', decision: 'confirm' });
            strict_1.default.equal(rec.allocatedAmount, 50_000);
            strict_1.default.equal((await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data().allocated, before + 50_000);
        });
        (0, node_test_1.it)('phụ huynh gửi minh chứng → chờ đối soát, KHÔNG ghi thu; phụ huynh không gửi cho con người khác', async () => {
            const before = (await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data();
            const r = await call(parent, 'payment.submitProof', { childId: 'c1', amount: 300_000, imagePath: `orgs/${orgId}/campuses/CG/proofs/a.jpg` }, { opId: op() });
            strict_1.default.equal(r.status, 'pending_reconciliation');
            const after = (await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data();
            strict_1.default.equal(after.allocated, before.allocated);
            strict_1.default.equal(after.balance, before.balance);
            await fails(parent, 'payment.submitProof', { childId: 'c2', amount: 1000, imagePath: `orgs/${orgId}/campuses/CG/proofs/a.jpg` }, 'PERMISSION_DENIED', { opId: op() });
        });
        (0, node_test_1.it)('đóng dư → credits; hủy phiếu qua duyệt tạo bút toán đảo, không mất lịch sử', async () => {
            // thanh toán dư: nợ còn lại ~2.05M → nộp 3.000.000 → dư
            const bal = (await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data().balance;
            const over = await call(acct, 'payment.record', { childId: 'c1', amount: bal + 400_000, channel: 'cash' }, { opId: op() });
            strict_1.default.equal(over.credit, 400_000);
            strict_1.default.equal((await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data().status, 'paid');
            // hủy phiếu đóng dư: cần duyệt (billing.approve)
            const cancel = await call(acct, 'payment.cancel', { paymentId: over.paymentId, reason: 'Nhập nhầm số tiền' });
            strict_1.default.equal(cancel.status, 'pending');
            strict_1.default.equal((await O(`payments/${over.paymentId}`).get()).data().status, 'confirmed'); // chưa đổi khi chưa duyệt
            await call(owner, 'approval.decide', { id: cancel.approvalId, decision: 'approved' });
            const orig = (await O(`payments/${over.paymentId}`).get()).data();
            strict_1.default.equal(orig.status, 'reversed');
            strict_1.default.ok((await O(`payments/rev_${over.paymentId}`).get()).exists, 'có bút toán đảo');
            strict_1.default.equal((await O(`receivables/rcv_c1_${periodNew}_monthly`).get()).data().balance, bal);
            strict_1.default.equal((await O(`credits/${over.paymentId}`).get()).data().status, 'reversed');
            // lịch sử còn nguyên: phiếu gốc + allocations gốc + allocations đảo
            strict_1.default.ok((await C('allocations').where('paymentId', '==', over.paymentId).get()).size >= 1);
            strict_1.default.ok((await C('allocations').where('paymentId', '==', `rev_${over.paymentId}`).get()).size >= 1);
            await fails(acct, 'payment.cancel', { paymentId: over.paymentId, reason: 'lần hai' }, 'INVALID_STATE');
        });
        (0, node_test_1.it)('receivable.adjust cần duyệt; hoàn tiền: duyệt ≠ đã chi (ghi giao dịch tiền ra khi refund.pay)', async () => {
            const paidRcv = `rcv_c1_${periodOld}_monthly`; // đã paid 500.000
            const adj = await call(acct, 'receivable.adjust', { receivableId: paidRcv, amount: -200_000, reason: 'Giảm trừ sai sót' });
            strict_1.default.equal((await O(`receivables/${paidRcv}`).get()).data().discount, 0); // chưa áp
            await call(owner, 'approval.decide', { id: adj.approvalId, decision: 'approved' });
            const r = (await O(`receivables/${paidRcv}`).get()).data();
            strict_1.default.equal(r.discount, 200_000);
            strict_1.default.equal(r.balance, 0);
            const adjDoc = (await O(`receivableAdjustments/${adj.id}`).get()).data();
            strict_1.default.equal(adjDoc.adjustsId, paidRcv);
            strict_1.default.equal(adjDoc.creditCreated, 200_000); // phần đã thu dư chuyển thành số dư có
            const rf = await call(acct, 'refund.request', { childId: 'c1', amount: 200_000, reason: 'Hoàn khoản thu dư' });
            await fails(acct, 'refund.pay', { id: rf.id }, 'INVALID_STATE', { opId: op() }); // chưa duyệt
            await call(owner, 'approval.decide', { id: rf.approvalId, decision: 'approved' });
            strict_1.default.equal((await O(`refunds/${rf.id}`).get()).data().status, 'approved');
            strict_1.default.equal((await C('payments').where('type', '==', 'refund').get()).size, 0); // đã duyệt nhưng CHƯA chi
            await call(acct, 'refund.pay', { id: rf.id, method: 'bank_transfer', reference: 'RF1' }, { opId: op() });
            strict_1.default.equal((await O(`refunds/${rf.id}`).get()).data().status, 'paid');
            strict_1.default.equal((await C('payments').where('type', '==', 'refund').get()).size, 1);
            void payId;
        });
        (0, node_test_1.it)('AT01 liên quan: kế toán cơ sở TX không đụng được dữ liệu CG', async () => {
            await fails(principalTX, 'billing.preview', { campusId: 'CG', periodKey: periodNew }, 'PERMISSION_DENIED');
            await fails(principalTX, 'payment.record', { childId: 'c1', amount: 1000, channel: 'cash' }, 'PERMISSION_DENIED', { opId: op() });
        });
    });
    // ============================================================ AT05 — suất ăn
    (0, node_test_1.describe)('AT05: chốt suất ăn mốc 08:00, sửa sau chốt có điều chỉnh', () => {
        const day = (0, time_1.addDays)(todayVN, 1);
        (0, node_test_1.it)('nghỉ duyệt TRƯỚC giờ chốt → hủy suất; SAU giờ chốt → vẫn tính', async () => {
            await O('children/c3').set({ campusId: 'CG', classId: 'cls1', code: 'MN003', fullName: 'Trần Bảo Châu', status: 'active', dob: '2023-03-03', enrolledAt: '2026-01-05', version: 1 });
            const at = (t) => firebase_1.Timestamp.fromDate(new Date(`${day}T${t}+07:00`));
            // c1: gửi + duyệt 07:00 trước giờ chốt (08:00) cùng ngày ăn
            await O('leaveRequests/l1').set({ childId: 'c1', campusId: 'CG', status: 'approved', fromDay: day, toDay: day, session: 'all', submittedAt: at('07:00:00'), decidedAt: at('07:30:00'), version: 1 });
            // c2: duyệt 09:00 sau giờ chốt
            await O('leaveRequests/l2').set({ childId: 'c2', campusId: 'CG', status: 'approved', fromDay: day, toDay: day, session: 'all', submittedAt: at('07:00:00'), decidedAt: at('09:00:00'), version: 1 });
            const r = await call(kitchen, 'meal.lock', { campusId: 'CG', dayKey: day });
            strict_1.default.equal(r.expected, 3);
            strict_1.default.equal(r.cancelled, 1);
            strict_1.default.equal(r.locked, 2);
            const o1 = (await O(`mealOrders/c1_${day}`).get()).data();
            strict_1.default.deepEqual([o1.expected, o1.locked, o1.billable, o1.cancelled], [true, false, false, true]);
            const o2 = (await O(`mealOrders/c2_${day}`).get()).data();
            strict_1.default.deepEqual([o2.expected, o2.locked, o2.billable, o2.cancelled], [true, true, true, false]);
            const again = await call(kitchen, 'meal.lock', { campusId: 'CG', dayKey: day });
            strict_1.default.equal(again.alreadyLocked, true); // không chốt lại, không xóa dấu vết
        });
        (0, node_test_1.it)('sửa kết quả tính phí sau chốt cần lý do và để lại lịch sử; chỉ MỘT kết quả cuối cùng', async () => {
            await fails(kitchen, 'meal.recordServed', { campusId: 'CG', dayKey: day, items: [{ childId: 'c2', billable: false }] }, 'VALIDATION');
            const r = await call(kitchen, 'meal.recordServed', { campusId: 'CG', dayKey: day, items: [{ childId: 'c2', served: false, billable: false, reason: 'Bé ốm đột xuất, đã gọi bếp trước' }, { childId: 'c3', served: true }] });
            strict_1.default.equal(r.adjustments, 1);
            const o2 = (await O(`mealOrders/c2_${day}`).get()).data();
            strict_1.default.equal(o2.billable, false);
            strict_1.default.equal(o2.served, false);
            strict_1.default.equal(o2.locked, true); // suất đã chốt cho bếp vẫn giữ nguyên
            strict_1.default.equal(o2.adjustments.length, 1);
            strict_1.default.deepEqual([o2.adjustments[0].from, o2.adjustments[0].to], [true, false]);
            strict_1.default.equal((await O(`mealOrders/c3_${day}`).get()).data().served, true);
        });
        (0, node_test_1.it)('trẻ ngoài cơ sở bị chặn (không tin client)', async () => {
            await fails(principalTX, 'meal.lock', { campusId: 'CG', dayKey: day }, 'PERMISSION_DENIED');
        });
    });
    // ============================================================ AT07 — công
    (0, node_test_1.describe)('AT07: thiếu lượt, ca qua đêm, nhiều cơ sở, khóa/mở lại kỳ', () => {
        const { from } = (0, time_1.periodRange)(PREV);
        const d1 = from;
        const d2 = (0, time_1.addDays)(from, 1);
        const d3 = (0, time_1.addDays)(from, 2);
        const pt = (d, hhmm) => firebase_1.Timestamp.fromDate((0, time_1.zonedTimeToDate)(d, hhmm));
        let punchSeq = 0;
        const punch = (emp, d, hhmm, kind, campusId = 'CG') => {
            const t = pt(d, hhmm);
            const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(t.toDate());
            return O(`punches/p${++punchSeq}`).set({ employeeId: emp, campusId, kind, source: 'app', deviceTime: t, serverTime: t, effectiveTime: t, dayKey, result: 'ok', immutable: true, version: 1 });
        };
        const snap = (startTime, endTime, breakMinutes, overnight = false) => ({ code: 'X', startTime, endTime, breakMinutes, lateGraceMinutes: 0, earlyGraceMinutes: 0, roundTo: 1, workUnit: 1, unitPolicy: 'full', overnight });
        const entry = (emp, d, shiftId, s, campusId = 'CG') => O(`rosterEntries/${emp}_${d}_${shiftId}`).set({ campusId, employeeId: emp, actualEmployeeId: null, dayKey: d, shiftId, shiftSnapshot: s, status: 'published', rosterId: 'x', version: 1 });
        let adjId = '';
        (0, node_test_1.before)(async () => {
            await O('shifts/HC').set({ campusId: 'CG', code: 'HC', name: 'Hành chính', startTime: '07:30', endTime: '17:00', breakMinutes: 90, lateGraceMinutes: 0, earlyGraceMinutes: 0, active: true, version: 1 });
            await O('shifts/DEM').set({ campusId: 'CG', code: 'DEM', name: 'Trực đêm', startTime: '22:00', endTime: '06:00', breakMinutes: 0, active: true, version: 1 });
            for (const [id, name, camp] of [['eA', 'Cô Lan', 'CG'], ['eB', 'Cô Mai', 'CG'], ['eC', 'Bảo vệ', 'CG']])
                await O(`employees/${id}`).set({ campusId: camp, campusIds: [camp], code: id, fullName: name, status: 'active', annualLeaveDays: 12, version: 1 });
            await O('staffAssignments/aB2').set({ employeeId: 'eB', campusId: 'TX', title: 'GV', fromDay: '2026-01-01', status: 'active', version: 1 });
            await O('staffAssignments/aB1').set({ employeeId: 'eB', campusId: 'CG', title: 'GV', fromDay: '2026-01-01', status: 'active', version: 1 });
            await O('shifts/TX1').set({ campusId: 'TX', code: 'TX1', name: 'Chiều TX', startTime: '11:00', endTime: '15:00', breakMinutes: 0, active: true, version: 1 });
            await O('shifts/CG1').set({ campusId: 'CG', code: 'CG1', name: 'Sáng CG', startTime: '07:00', endTime: '12:00', breakMinutes: 0, active: true, version: 1 });
            // eA: d1 đủ lượt (07:40–17:00); d2 thiếu lượt ra
            await entry('eA', d1, 'HC', snap('07:30', '17:00', 90));
            await entry('eA', d2, 'HC', snap('07:30', '17:00', 90));
            await punch('eA', d1, '07:40', 'in');
            await punch('eA', d1, '17:00', 'out');
            await punch('eA', d2, '07:30', 'in');
            // eC: ca đêm d1 22:00 → 06:00 hôm sau
            await entry('eC', d1, 'DEM', snap('22:00', '06:00', 0, true));
            await punch('eC', d1, '21:55', 'in');
            await punch('eC', (0, time_1.addDays)(d1, 1), '06:05', 'out');
        });
        (0, node_test_1.it)('timesheet.build: ví dụ chuẩn 470 phút, muộn 10; thiếu lượt = incomplete không đủ công; ca đêm thuộc ngày bắt đầu', async () => {
            const r = await call(hr, 'timesheet.build', { campusId: 'CG', periodKey: PREV });
            const A = r.employees.find((e) => e.employeeId === 'eA');
            strict_1.default.equal(A.totals.workedMinutes, 470);
            strict_1.default.equal(A.totals.lateMinutes, 10);
            strict_1.default.equal(A.totals.incompleteDays, 1);
            strict_1.default.equal(A.paidDaysTotal, 1); // chỉ ngày đủ lượt; ngày thiếu lượt KHÔNG tự tính đủ công
            const C2 = r.employees.find((e) => e.employeeId === 'eC');
            strict_1.default.equal(C2.totals.workedMinutes, 480);
            const d1Row = (await O(`timesheetDays/CG_${PREV}_eC_${d1}`).get()).data();
            strict_1.default.equal(d1Row.status, 'ok'); // thuộc ngày bắt đầu ca
            const d2Row = (await O(`timesheetDays/CG_${PREV}_eA_${d2}`).get()).data();
            strict_1.default.equal(d2Row.status, 'incomplete');
            strict_1.default.ok(r.errorCount >= 1);
        });
        (0, node_test_1.it)('khóa kỳ bị chặn khi còn lỗi chưa xử lý', async () => {
            const e = await fails(hr, 'timesheet.lock', { campusId: 'CG', periodKey: PREV }, 'PRECONDITION');
            strict_1.default.equal(e.details.reason, 'UNRESOLVED_ERRORS');
        });
        (0, node_test_1.it)('bổ sung lượt: duyệt tạo điều chỉnh liên kết, KHÔNG sửa lượt gốc', async () => {
            const req = await call(empA, 'punchAdjust.request', { dayKey: d2, kind: 'out', requestedTime: '17:00', reason: 'Quên chấm ra, có xác nhận quản lý' });
            adjId = req.id;
            await fails(empA, 'punchAdjust.decide', { id: adjId, decision: 'approved' }, 'PERMISSION_DENIED'); // không tự duyệt
            const originalsBefore = (await C('punches').get()).size;
            await call(hr, 'punchAdjust.decide', { id: adjId, decision: 'approved', note: 'OK' });
            strict_1.default.equal((await C('punches').get()).size, originalsBefore); // lượt gốc không đổi/không xóa
            strict_1.default.equal((await O(`punchAdjustments/${adjId}`).get()).data().status, 'approved');
            const r = await call(hr, 'timesheet.build', { campusId: 'CG', periodKey: PREV });
            const A = r.employees.find((e) => e.employeeId === 'eA');
            strict_1.default.equal(A.totals.incompleteDays, 0);
            strict_1.default.equal(A.paidDaysTotal, 2);
        });
        (0, node_test_1.it)('khóa kỳ tạo bản chụp; sau khóa không build lại/không bổ sung công/không đổi lịch', async () => {
            const r = await call(hr, 'timesheet.lock', { campusId: 'CG', periodKey: PREV });
            strict_1.default.equal(r.status, 'locked');
            const snaps = await C(`timesheets/CG_${PREV}/snapshots`).get();
            strict_1.default.ok(snaps.size >= 2);
            const sA = snaps.docs.find((d) => d.data().employeeId === 'eA').data();
            strict_1.default.equal(sA.punches.length, 3);
            strict_1.default.equal(sA.adjustments.length, 1);
            // đổi cấu hình ca sau khóa không đổi kỳ đã khóa
            await O('shifts/HC').update({ startTime: '08:30', breakMinutes: 0 });
            await fails(hr, 'timesheet.build', { campusId: 'CG', periodKey: PREV }, 'INVALID_STATE');
            const row = (await O(`timesheetDays/CG_${PREV}_eA_${d1}`).get()).data();
            strict_1.default.equal(row.workedMinutes, 470);
            strict_1.default.equal(row.locked, true);
            await fails(empA, 'punchAdjust.request', { dayKey: d1, kind: 'in', requestedTime: '07:30', reason: 'Sửa sau khóa kỳ' }, 'PRECONDITION');
            const future = (0, time_1.addDays)(todayVN, 5);
            await fails(owner, 'roster.publish', { campusId: 'CG', fromDay: d1, toDay: d1, entries: [] }, 'PRECONDITION');
            void future;
        });
        (0, node_test_1.it)('mở lại kỳ cần quyền riêng + lý do: HR chỉ gửi yêu cầu, người có timekeeping.reopen duyệt', async () => {
            await fails(hr, 'timesheet.reopen', { campusId: 'CG', periodKey: PREV, reason: 'ngắn' }, 'VALIDATION');
            const rq = await call(hr, 'timesheet.reopen', { campusId: 'CG', periodKey: PREV, reason: 'Bổ sung công sau khi nhân viên phản hồi' });
            strict_1.default.equal(rq.status, 'pending');
            await fails(hr, 'approval.decide', { id: rq.approvalId, decision: 'approved' }, 'PERMISSION_DENIED'); // HR không có timekeeping.reopen
            strict_1.default.equal((await O(`timesheets/CG_${PREV}`).get()).data().status, 'locked');
            await call(owner, 'approval.decide', { id: rq.approvalId, decision: 'approved' });
            const t = (await O(`timesheets/CG_${PREV}`).get()).data();
            strict_1.default.equal(t.status, 'reopened');
            strict_1.default.equal(t.reportsStale, true);
            strict_1.default.equal(t.reopenHistory.length, 1);
        });
        (0, node_test_1.it)('chuyển chênh lệch sang kỳ điều chỉnh (carry_forward) khi không mở lại', async () => {
            await call(hr, 'timesheet.build', { campusId: 'CG', periodKey: PREV });
            await call(hr, 'timesheet.lock', { campusId: 'CG', periodKey: PREV });
            const r = await call(hr, 'timesheet.reopen', { campusId: 'CG', periodKey: PREV, reason: 'Chênh lệch nửa công phát hiện muộn', mode: 'carry_forward', carry: [{ employeeId: 'eA', deltaPaidDays: 0.5 }] });
            strict_1.default.equal(r.mode, 'carry_forward');
            strict_1.default.equal((await O(`timesheets/CG_${PREV}`).get()).data().status, 'locked'); // kỳ cũ không đổi
            const adj = await C('timesheetAdjustments').where('employeeId', '==', 'eA').get();
            strict_1.default.equal(adj.size, 1);
            strict_1.default.equal(adj.docs[0].data().toPeriodKey, NEXT_MONTH_KEY);
        });
        (0, node_test_1.it)('nhiều cơ sở: ca trùng thời gian giữa CG và TX bị chặn khi công bố lịch', async () => {
            const day = (0, time_1.addDays)(todayVN, 10);
            const ok = await call(hr, 'roster.publish', { campusId: 'CG', fromDay: day, toDay: day, entries: [{ employeeId: 'eB', dayKey: day, shiftId: 'CG1' }], acknowledgeShortage: true });
            strict_1.default.equal(ok.entries, 1);
            const e = await fails(hr, 'roster.publish', { campusId: 'TX', fromDay: day, toDay: day, entries: [{ employeeId: 'eB', dayKey: day, shiftId: 'TX1' }], acknowledgeShortage: true }, 'PRECONDITION');
            strict_1.default.equal(e.details.reason, 'SHIFT_OVERLAP');
            // cùng người nhưng không trùng giờ thì được
            await O('shifts/TX2').set({ campusId: 'TX', code: 'TX2', name: 'Chiều muộn TX', startTime: '13:00', endTime: '17:00', breakMinutes: 0, active: true, version: 1 });
            const ok2 = await call(hr, 'roster.publish', { campusId: 'TX', fromDay: day, toDay: day, entries: [{ employeeId: 'eB', dayKey: day, shiftId: 'TX2' }], acknowledgeShortage: true });
            strict_1.default.equal(ok2.entries, 1);
        });
        (0, node_test_1.it)('đổi ca: người nhận đồng ý + quản lý duyệt; lưu người làm thực tế', async () => {
            const day = (0, time_1.addDays)(todayVN, 12);
            await O(`rosterEntries/eA_${day}_HC`).set({ campusId: 'CG', employeeId: 'eA', actualEmployeeId: null, dayKey: day, shiftId: 'HC', shiftSnapshot: snap('07:30', '17:00', 90), status: 'published', version: 1 });
            const empB = who('empB');
            await member(empB, 'staff', [{ id: 'g', roleId: 'teacher', campusIds: ['CG'] }], { employeeId: 'eB' });
            const rq = await call(empA, 'shiftSwap.request', { entryId: `eA_${day}_HC`, toEmployeeId: 'eB', reason: 'Việc gia đình' });
            await fails(hr, 'shiftSwap.decide', { id: rq.id, decision: 'approved' }, 'INVALID_STATE'); // chưa có đồng ý của người nhận
            await fails(empA, 'shiftSwap.respond', { id: rq.id, accept: true }, 'PERMISSION_DENIED');
            const rs = await call(empB, 'shiftSwap.respond', { id: rq.id, accept: true });
            strict_1.default.equal(rs.status, 'awaiting_manager');
            await call(hr, 'shiftSwap.decide', { id: rq.id, decision: 'approved' });
            const e = (await O(`rosterEntries/eA_${day}_HC`).get()).data();
            strict_1.default.equal(e.actualEmployeeId, 'eB');
            strict_1.default.equal(e.employeeId, 'eA'); // giữ người gốc để truy vết
        });
        (0, node_test_1.it)('nghỉ phép: kiểm tra số dư; duyệt đánh dấu ca nghỉ', async () => {
            const day = (0, time_1.addDays)(todayVN, 20);
            await fails(empA, 'staffLeave.request', { type: 'annual', fromDay: day, toDay: (0, time_1.addDays)(day, 30), reason: 'Du lịch dài ngày' }, 'LIMIT');
            const rq = await call(empA, 'staffLeave.request', { type: 'annual', fromDay: day, toDay: day, reason: 'Việc riêng' });
            strict_1.default.equal(rq.status, 'pending');
            await fails(empA, 'staffLeave.decide', { id: rq.id, decision: 'approved' }, 'PERMISSION_DENIED');
            const d = await call(hr, 'staffLeave.decide', { id: rq.id, decision: 'approved' });
            strict_1.default.equal(d.status, 'approved');
        });
    });
    // ============================================================ Lương
    (0, node_test_1.describe)('Lương: từ bảng công đã khóa, trạng thái tách biệt', () => {
        let runId = '';
        (0, node_test_1.it)('chỉ lập bảng lương từ bảng công ĐÃ KHÓA', async () => {
            await fails(hr, 'payroll.build', { campusId: 'CG', periodKey: NEXT_MONTH_KEY }, 'PRECONDITION');
        });
        (0, node_test_1.it)('payroll.build → submit → approve → publish → recordPayment nhiều đợt', async () => {
            await O('contracts/ct1').set({ employeeId: 'eA', campusId: 'CG', type: 'indefinite', startDate: '2026-01-01', status: 'active', version: 1 });
            await call(hr, 'salary.save', { employeeId: 'eA', baseSalary: 8_000_000, components: [{ code: 'TC', name: 'Phụ cấp', type: 'allowance', amount: 500_000 }] });
            const b = await call(hr, 'payroll.build', { campusId: 'CG', periodKey: PREV, standardDays: 26 });
            strict_1.default.equal(b.headcount, 1);
            strict_1.default.equal(b.errors.length, 1); // eC có trong bảng công nhưng chưa có lương/hợp đồng
            runId = b.runId;
            const it0 = b.items[0];
            // eA: 2 công + 0,5 công chuyển kỳ không áp dụng cho kỳ này; công = 2 (d1,d2 sau điều chỉnh)
            strict_1.default.equal(it0.paidDays, 2);
            strict_1.default.equal(it0.basePay, Math.round((8_000_000 * 2) / 26));
            await fails(hr, 'payroll.publish', { runId }, 'INVALID_STATE'); // chưa duyệt
            await fails(hr, 'payroll.submit', { runId }, 'PRECONDITION'); // còn nhân viên lỗi
            const sub = await call(hr, 'payroll.submit', { runId, acknowledgeErrors: true });
            await fails(hr, 'payroll.approve', { runId }, 'PERMISSION_DENIED');
            await call(owner, 'approval.decide', { id: sub.approvalId, decision: 'approved' });
            strict_1.default.equal((await O(`payrollRuns/${runId}`).get()).data().status, 'approved');
            strict_1.default.equal((await C('payslips').get()).size, 0); // đã duyệt ≠ đã phát hành
            await call(hr, 'payroll.publish', { runId });
            strict_1.default.equal((await C('payslips').get()).size, 1);
            const net = (await O(`payrollRuns/${runId}/items/eA`).get()).data().net;
            await call(hr, 'payroll.recordPayment', { runId, items: [{ employeeId: 'eA', amount: 1_000_000 }] }, { opId: op() });
            let run = (await O(`payrollRuns/${runId}`).get()).data();
            strict_1.default.equal(run.status, 'published'); // đã phát hành, mới trả một phần
            strict_1.default.equal(run.paymentStatus, 'partially_paid');
            await fails(hr, 'payroll.recordPayment', { runId, items: [{ employeeId: 'eA', amount: net }] }, 'VALIDATION', { opId: op() }); // vượt số còn phải trả
            await call(hr, 'payroll.recordPayment', { runId, items: [{ employeeId: 'eA', amount: net - 1_000_000 }] }, { opId: op() });
            run = (await O(`payrollRuns/${runId}`).get()).data();
            strict_1.default.equal(run.status, 'paid');
            strict_1.default.equal(run.paymentStatus, 'paid');
            // khóa kỳ công đã duyệt lương → không mở lại
            await fails(hr, 'timesheet.reopen', { campusId: 'CG', periodKey: PREV, reason: 'Muốn sửa công sau khi đã trả lương' }, 'PRECONDITION');
        });
        (0, node_test_1.it)('nhân viên (không có payroll.read) không lập được bảng lương', async () => {
            await fails(empA, 'payroll.build', { campusId: 'CG', periodKey: PREV }, 'PERMISSION_DENIED');
        });
    });
    // ============================================================ Báo cáo & xuất
    (0, node_test_1.describe)('Báo cáo', () => {
        (0, node_test_1.it)('tuition: không cộng lặp nợ; có definitions và rows', async () => {
            const r = await call(owner, 'report.get', { type: 'tuition', campusId: 'CG', from: '2026-10-01', to: '2026-10-31' });
            strict_1.default.ok(r.definitions.outstanding);
            strict_1.default.ok(r.rows.length >= 1);
            const sumBalance = r.rows.reduce((s, x) => s + x.balance, 0);
            strict_1.default.equal(r.metrics.outstanding, sumBalance);
        });
        (0, node_test_1.it)('phạm vi theo cơ sở: hiệu trưởng TX không xem được CG', async () => {
            await fails(principalTX, 'report.get', { type: 'enrollment', campusId: 'CG', to: todayVN }, 'PERMISSION_DENIED');
            const r = await call(principalTX, 'report.get', { type: 'enrollment', to: todayVN });
            strict_1.default.deepEqual(r.campusIds, ['TX']);
        });
        (0, node_test_1.it)('export.csv cần reports.export và ghi audit', async () => {
            await fails(principalTX, 'export.csv', { report: 'cashflow', filters: { from: '2026-10-01', to: '2026-11-30' } }, 'PERMISSION_DENIED').catch(() => undefined);
            const r = await call(acct, 'export.csv', { report: 'cashflow', filters: { campusId: 'CG', from: '2026-10-01', to: '2026-12-31' } });
            strict_1.default.ok(r.csv.includes('# collected'));
            const logs = await C('auditLogs').where('action', '==', 'export.csv').get();
            strict_1.default.ok(logs.size >= 1);
        });
        (0, node_test_1.it)('dashboard.campus', async () => {
            const r = await call(owner, 'dashboard.campus', { campusId: 'CG' });
            strict_1.default.equal(r.campusId, 'CG');
            strict_1.default.equal(typeof r.enrolled, 'number');
        });
    });
    // ============================================================ Kho / thực đơn / đưa đón
    (0, node_test_1.describe)('Kho, tài sản, đưa đón', () => {
        (0, node_test_1.it)('stock: nhập lô, xuất FEFO, không tồn âm', async () => {
            await O('stockItems/rice').set({ campusId: 'CG', code: 'GAO', name: 'Gạo', unit: 'kg', onHand: 0, conversions: [{ unit: 'bao', factor: 10 }], version: 1 });
            const exp1 = (0, time_1.addDays)(todayVN, 30);
            const exp2 = (0, time_1.addDays)(todayVN, 5);
            await call(kitchen, 'stock.receive', { itemId: 'rice', lot: 'L-LATE', expiry: exp1, qty: 10, unitCost: 20_000, supplier: 'NCC1' }, { opId: op() });
            const rc = await call(kitchen, 'stock.receive', { itemId: 'rice', lot: 'L-SOON', expiry: exp2, qty: 1, unit: 'bao', unitCost: 200_000, supplier: 'NCC1' }, { opId: op() });
            strict_1.default.equal(rc.qty, 10);
            const out = await call(kitchen, 'stock.issue', { itemId: 'rice', qty: 12, purpose: 'kitchen' }, { opId: op() });
            strict_1.default.equal(out.issued[0].lot, 'L-SOON'); // lô sắp hết hạn trước
            strict_1.default.equal(out.issued[0].qty, 10);
            strict_1.default.equal(out.issued[1].qty, 2);
            strict_1.default.equal((await O('stockItems/rice').get()).data().onHand, 8);
            await fails(kitchen, 'stock.issue', { itemId: 'rice', qty: 100 }, 'PRECONDITION', { opId: op() });
            await fails(kitchen, 'stock.issue', { itemId: 'rice', qty: 100, allowNegative: true, reason: 'Xuất âm có lý do' }, 'PERMISSION_DENIED', { opId: op() }); // cần quyền ngoại lệ
            const dup = op();
            const i1 = await call(kitchen, 'stock.issue', { itemId: 'rice', qty: 1 }, { opId: dup });
            const i2 = await call(kitchen, 'stock.issue', { itemId: 'rice', qty: 1 }, { opId: dup });
            strict_1.default.deepEqual(i1, i2);
            strict_1.default.equal((await O('stockItems/rice').get()).data().onHand, 7);
        });
        (0, node_test_1.it)('kiểm kê chênh lệch cần duyệt; chuyển kho: đang vận chuyển → bên nhận xác nhận', async () => {
            const st = await call(kitchen, 'stock.stocktake', { campusId: 'CG', counts: [{ itemId: 'rice', countedQty: 6 }] });
            strict_1.default.equal(st.status, 'pending_approval');
            await fails(kitchen, 'stock.approveVariance', { id: st.id, decision: 'approved' }, 'PERMISSION_DENIED');
            await call(owner, 'approval.decide', { id: st.approvalId, decision: 'approved' });
            strict_1.default.equal((await O('stockItems/rice').get()).data().onHand, 6);
            await O('stockItems/rice_tx').set({ campusId: 'TX', code: 'GAO', name: 'Gạo', unit: 'kg', onHand: 0, version: 1 });
            const tf = await call(owner, 'stock.transfer.send', { campusId: 'CG', toCampusId: 'TX', lines: [{ itemId: 'rice', qty: 4 }] }, { opId: op() });
            strict_1.default.equal(tf.status, 'in_transit');
            strict_1.default.equal((await O('stockItems/rice').get()).data().onHand, 2);
            strict_1.default.equal((await O('stockItems/rice_tx').get()).data().onHand, 0); // chưa nhận
            await fails(kitchen, 'stock.transfer.receive', { id: tf.id }, 'PERMISSION_DENIED', { opId: op() }); // kitchen CG không phải bên nhận
            await call(principalTX, 'stock.transfer.receive', { id: tf.id }, { opId: op() }).catch(async () => call(owner, 'stock.transfer.receive', { id: tf.id }, { opId: op() }));
            strict_1.default.equal((await O('stockItems/rice_tx').get()).data().onHand, 4);
        });
        (0, node_test_1.it)('tài sản: đúng quy trình trạng thái, giữ lịch sử', async () => {
            await O('assets/a1').set({ campusId: 'CG', code: 'AC01', name: 'Điều hòa', status: 'created', history: 0, version: 1 });
            await fails(owner, 'asset.transition', { assetId: 'a1', to: 'in_use' }, 'INVALID_STATE');
            await call(owner, 'asset.transition', { assetId: 'a1', to: 'handed_over', assigneeUid: 'hr' });
            await call(owner, 'asset.transition', { assetId: 'a1', to: 'in_use' });
            await call(owner, 'asset.transition', { assetId: 'a1', to: 'repair_requested', note: 'Không lạnh' });
            await call(owner, 'asset.transition', { assetId: 'a1', to: 'repair_assigned', assigneeUid: 'kitchen' });
            await call(owner, 'asset.transition', { assetId: 'a1', to: 'repair_accepted' });
            strict_1.default.equal((await C('assets/a1/history').get()).size, 5);
        });
        (0, node_test_1.it)('đưa đón: đối chiếu số trẻ trên xe, không dùng điểm danh lớp', async () => {
            await O('routes/r1').set({ campusId: 'CG', code: 'R1', name: 'Tuyến 1', childIds: ['c1', 'c2'], active: true, version: 1 });
            await O('trips/t1').set({ campusId: 'CG', routeId: 'r1', dayKey: todayVN, direction: 'to_home', status: 'planned', onboardCount: 0, version: 1 });
            const tr = who('transport');
            await member(tr, 'staff', [{ id: 'g', roleId: 'transport', campusIds: ['CG'] }]);
            await call(tr, 'trip.start', { tripId: 't1' });
            await call(tr, 'trip.board', { tripId: 't1', childId: 'c1' });
            await call(tr, 'trip.board', { tripId: 't1', childId: 'c2' });
            await fails(tr, 'trip.board', { tripId: 't1', childId: 'c1' }, 'CONFLICT');
            await fails(tr, 'trip.board', { tripId: 't1', childId: 'c3' }, 'PRECONDITION');
            await call(tr, 'trip.alight', { tripId: 't1', childId: 'c1' });
            await call(tr, 'trip.handover', { tripId: 't1', childId: 'c1', receivedBy: { name: 'Mẹ An', relation: 'mother' }, verification: { method: 'phone_call' } });
            const e = await fails(tr, 'trip.endCheck', { tripId: 't1', vehicleEmpty: true, countedOnboard: 0 }, 'PRECONDITION'); // hệ thống còn c2 trên xe
            strict_1.default.equal(e.details.reason, 'TRIP_DISCREPANCY');
            strict_1.default.equal((await O('trips/t1').get()).data().status, 'needs_review');
            strict_1.default.ok((await C('alerts').where('type', '==', 'trip_discrepancy').get()).size >= 1);
        });
        (0, node_test_1.it)('thực đơn: trẻ dị ứng → bắt chọn món thay thế', async () => {
            await O('children/c1/private/health').set({ allergies: ['tôm'], version: 1 });
            await O('menus/m1').set({ campusId: 'CG', dayKey: (0, time_1.addDays)(todayVN, 3), status: 'draft', meals: [{ session: 'lunch', dishes: [{ name: 'Canh tôm rau', allergens: ['tôm'] }] }], version: 1 });
            const e = await fails(kitchen, 'menu.submit', { id: 'm1' }, 'PRECONDITION');
            strict_1.default.equal(e.details.reason, 'ALLERGY_SUBSTITUTION_REQUIRED');
            strict_1.default.equal(e.details.conflicts[0].childId, 'c1');
            const ok = await call(kitchen, 'menu.submit', { id: 'm1', substitutions: [{ childId: 'c1', dish: 'Canh tôm rau', replacement: 'Canh rau thịt' }] });
            strict_1.default.equal(ok.status, 'submitted');
        });
    });
    // ============================================================ Nhập dữ liệu
    (0, node_test_1.describe)('Nhập dữ liệu', () => {
        (0, node_test_1.it)('import.validate báo lỗi từng dòng; không tự ghép theo tên; SĐT ≠ mã trẻ', async () => {
            const v = await call(owner, 'import.validate', {
                kind: 'children', campusId: 'CG', rows: [
                    { code: 'MN900', fullName: 'Lê Thị Hoa', dob: '2023-01-01', classCode: 'M1', guardianName: 'Mẹ Hoa', guardianPhone: '0912345678' },
                    { code: 'MN001', fullName: 'Trùng mã', dob: '2023-01-01' },
                    { fullName: 'Nguyễn Minh An', dob: '2023-05-12' },
                    { fullName: 'X', dob: '2999-01-01' },
                ],
            });
            strict_1.default.equal(v.total, 4);
            strict_1.default.equal(v.rows[0].ok, true);
            strict_1.default.equal(v.rows[1].ok, false); // trùng mã MN001
            strict_1.default.equal(v.rows[2].ok, true); // trùng tên + ngày sinh chỉ CẢNH BÁO
            strict_1.default.ok(v.rows[2].warnings.length >= 1);
            strict_1.default.equal(v.rows[3].ok, false);
            strict_1.default.ok(v.errorCsv.includes('Dòng,Trường,Lỗi'));
            await fails(owner, 'import.commit', { jobId: v.jobId }, 'PRECONDITION'); // còn dòng lỗi
            const g = await call(owner, 'import.validate', { kind: 'guardians', campusId: 'CG', rows: [{ childCode: 'MN001', name: 'Phụ huynh A', phone: '0911111111' }, { childCode: 'MN002', name: 'Phụ huynh A', phone: '0911111111' }, { childCode: 'MN001', name: 'Sai', phone: 'MN001' }] });
            strict_1.default.equal(g.rows[0].ok && g.rows[1].ok, true); // một SĐT nhiều trẻ được phép
            strict_1.default.equal(g.rows[2].ok, false);
        });
        (0, node_test_1.it)('backup.record / verify (không có action phục hồi)', async () => {
            const b = await call(owner, 'backup.record', { kind: 'scheduled', status: 'success', location: 'gs://bucket/exports/2026-11-05' });
            const v = await call(owner, 'backup.verify', { backupId: b.id, result: 'success', notes: 'Khôi phục thử trên staging OK' });
            strict_1.default.equal(v.result, 'success');
            strict_1.default.equal((await O(`backups/${b.id}`).get()).data().lastVerifyResult, 'success');
            await fails(owner, 'backup.restore', {}, 'NOT_FOUND');
            await fails(kitchen, 'backup.record', { status: 'success' }, 'PERMISSION_DENIED');
        });
    });
});
