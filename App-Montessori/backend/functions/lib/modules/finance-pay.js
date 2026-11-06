"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
exports.applyConfirmedPayment = applyConfirmedPayment;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const entity_registry_1 = require("../core/entity-registry");
const approvals_1 = require("../core/approvals");
const validate_1 = require("../core/validate");
const common_1 = require("../lib/common");
const calc_fee_1 = require("../lib/calc-fee");
const finance_common_1 = require("../lib/finance-common");
const ledger_1 = require("../lib/ledger");
// ---------------------------------------------------------------- Entity: expenses (draft)
(0, entity_registry_1.registerEntity)('expenses', {
    writePerm: 'expenses.write', campusScoped: true, idPrefix: 'ex_', editableStatuses: ['draft', 'rejected'],
    schema: {
        category: { t: 'string', req: true, max: 60 }, amount: { t: 'int', req: true, min: 1, max: 10_000_000_000 },
        description: { t: 'string', req: true, max: 500 }, vendor: { t: 'string', max: 150 }, expenseDate: { t: 'day' },
        evidencePaths: { t: 'array', max: 10 }, status: { t: 'string', oneOf: ['draft'] },
    },
    async beforeSave(_ctx, _data, existing) { return existing ? { status: 'draft' } : { status: 'draft' }; },
});
const toSafeKey = (s) => /^[A-Za-z0-9_-]{1,120}$/.test(s);
const todayOf = (ctx, campus) => (0, store_1.dayKeyOf)(ctx.now, (0, common_1.tzOf)(campus));
async function applyConfirmedPayment(ctx, a) {
    const today = (0, store_1.dayKeyOf)(ctx.now, a.tz);
    return ctx.tx(async (t) => {
        const pref = ctx.doc(`payments/${a.paymentId}`);
        const [ps, rs] = await Promise.all([
            t.get(pref),
            t.get(ctx.col('receivables').where('childId', '==', a.childId).where('status', 'in', [...finance_common_1.OPEN_STATUSES])),
        ]);
        if (a.mode === 'create' && ps.exists)
            (0, errors_1.fail)('CONFLICT', 'Giao dịch này đã được ghi nhận trước đó (trùng mã); không ghi thu lần hai.', { paymentId: a.paymentId, reason: 'DUPLICATE_PAYMENT' });
        if (a.mode === 'confirm_pending' && (!ps.exists || ps.data()?.status !== 'pending_reconciliation'))
            (0, errors_1.fail)('INVALID_STATE', 'Giao dịch không ở trạng thái chờ đối soát.');
        const open = rs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.campusId === a.campusId);
        let plan;
        try {
            plan = (0, calc_fee_1.allocatePayment)(a.amount, open.map((r) => ({ id: r.id, periodKey: r.periodKey, dueDate: r.dueDate, balance: r.balance })), a.manual ?? []);
        }
        catch (e) {
            (0, errors_1.invalid)({ allocations: e.message });
        }
        const debtBefore = open.reduce((s, r) => s + r.balance, 0);
        const now = firebase_1.Timestamp.now();
        const touched = new Map(plan.allocations.map((x) => [x.receivableId, x.amount]));
        for (const r of open) {
            const amt = touched.get(r.id);
            if (!amt)
                continue;
            const st = (0, finance_common_1.rcvState)(r, { allocated: (r.allocated ?? 0) + amt }, today);
            t.update(ctx.doc(`receivables/${r.id}`), (0, finance_common_1.patchOf)(ctx, r.version, { allocated: st.allocated, balance: st.balance, status: st.status, isOverdue: st.isOverdue, pendingReconciliation: false, lastPaymentAt: now }));
            t.set(ctx.doc(`allocations/${a.paymentId}_${r.id}`), {
                paymentId: a.paymentId, receivableId: r.id, childId: a.childId, campusId: a.campusId, periodKey: r.periodKey, amount: amt, kind: 'payment', at: now, ...ctx.metaCreate(),
            });
        }
        const payDoc = {
            ...a.fields, type: 'receipt', sign: 1, childId: a.childId, campusId: a.campusId, amount: a.amount, channel: a.channel, status: 'confirmed',
            allocatedAmount: plan.allocated, creditAmount: plan.credit, allocations: plan.allocations, receivedAt: firebase_1.Timestamp.fromDate(a.at), receivedBy: ctx.uid,
        };
        if (a.mode === 'create')
            t.set(pref, { ...payDoc, ...ctx.metaCreate() });
        else
            t.update(pref, (0, finance_common_1.patchOf)(ctx, ps.data()?.version, { ...payDoc, confirmedAt: now, confirmedBy: ctx.uid }));
        if (plan.credit > 0) {
            t.set(ctx.doc(`credits/${a.paymentId}`), { childId: a.childId, campusId: a.campusId, paymentId: a.paymentId, amount: plan.credit, remaining: plan.credit, status: 'open', ...ctx.metaCreate() });
        }
        t.set(ctx.doc(`cashLedger/payment_${a.paymentId}`), (0, ledger_1.ledgerData)(ctx, { campusId: a.campusId, dir: 'in', amount: a.amount, channel: a.channel, refType: 'payment', refId: a.paymentId, childId: a.childId, at: a.at, tz: a.tz }));
        return { paymentId: a.paymentId, amount: a.amount, allocations: plan.allocations, allocatedAmount: plan.allocated, credit: plan.credit, debtBefore, debtAfter: debtBefore - plan.allocated };
    });
}
async function childOf(ctx, childId) {
    return (0, common_1.getInCampus)(ctx, 'children', childId, null, 'Trẻ');
}
function parseManual(v) {
    if (v === undefined || v === null)
        return [];
    if (!Array.isArray(v))
        (0, errors_1.invalid)({ allocations: 'Phân bổ phải là danh sách.' });
    return v.map((x, i) => {
        if (typeof x?.receivableId !== 'string')
            (0, errors_1.invalid)({ [`allocations[${i}].receivableId`]: 'Bắt buộc.' });
        return { receivableId: x.receivableId, amount: (0, common_1.needVnd)(x.amount, `allocations[${i}].amount`) };
    });
}
const paymentRecord = async (ctx, p) => {
    const child = await childOf(ctx, p?.childId);
    const campusId = child.campusId;
    ctx.require('payments.write', campusId);
    const campus = await (0, store_1.getCampus)(ctx, campusId);
    const amount = (0, common_1.needVnd)(p?.amount);
    const channel = p?.channel;
    if (!['cash', 'bank_transfer', 'gateway'].includes(channel))
        (0, errors_1.invalid)({ channel: 'Kênh thanh toán: cash | bank_transfer | gateway.' });
    const reference = typeof p?.reference === 'string' && p.reference.trim() ? p.reference.trim() : undefined;
    if (channel !== 'cash' && !reference)
        (0, errors_1.invalid)({ reference: 'Chuyển khoản/cổng thanh toán cần mã giao dịch tham chiếu.' });
    const at = (0, common_1.toDate)(p?.receivedAt) ?? ctx.now;
    if (at.getTime() > Date.now() + 5 * 60_000)
        (0, errors_1.invalid)({ receivedAt: 'Thời điểm nhận tiền không được ở tương lai.' });
    // Giao dịch ngoài tiền mặt dùng khóa duy nhất theo nguồn + mã → không thể ghi thu hai lần.
    const key = channel !== 'cash' ? `${typeof p?.source === 'string' && p.source ? p.source : channel}_${reference}` : `pm_${ctx.opId}`;
    if (!toSafeKey(key))
        (0, errors_1.invalid)({ reference: 'Mã giao dịch chỉ gồm chữ, số, gạch dưới/gạch ngang.' });
    const r = await applyConfirmedPayment(ctx, {
        paymentId: key, childId: child.id, campusId, tz: (0, common_1.tzOf)(campus), amount, channel, at, manual: parseManual(p?.allocations),
        fields: { reference: reference ?? null, note: typeof p?.note === 'string' ? p.note.slice(0, 500) : null, opId: ctx.opId, source: p?.source ?? channel, childName: (0, finance_common_1.childName)(child) },
        mode: 'create',
    });
    await ctx.audit({ action: 'payment.record', collection: 'payments', docId: key, campusId, after: { childId: child.id, amount, channel, allocations: r.allocations, credit: r.credit } });
    return r;
};
// ---------------------------------------------------------------- phụ huynh gửi minh chứng
const paymentSubmitProof = async (ctx, p) => {
    const childId = (0, common_1.needStr)(p?.childId, 'childId');
    if (!(ctx.member?.childIds ?? []).includes(childId))
        (0, errors_1.fail)('PERMISSION_DENIED', 'Bạn không được liên kết với trẻ này.');
    const child = await childOf(ctx, childId);
    const amount = (0, common_1.needVnd)(p?.amount);
    const imagePath = (0, common_1.needStr)(p?.imagePath, 'imagePath', 400);
    if (!imagePath.startsWith(`orgs/${ctx.orgId}/campuses/${child.campusId}/`) || imagePath.includes('..'))
        (0, errors_1.invalid)({ imagePath: 'Đường dẫn ảnh không hợp lệ.' });
    const links = (0, common_1.asDocs)(await ctx.col('guardianLinks').where('childId', '==', childId).where('uid', '==', ctx.uid).get());
    if (links.length && links.every((l) => l.perms?.viewFees === false))
        (0, errors_1.fail)('PERMISSION_DENIED', 'Bạn không có quyền thao tác học phí của trẻ này.');
    const id = `pm_${ctx.opId}`;
    // KHÔNG ghi thu, không đổi công nợ: chỉ chờ đối soát.
    await (0, store_1.createDoc)(ctx, 'payments', id, {
        type: 'proof', sign: 0, childId, childName: (0, finance_common_1.childName)(child), campusId: child.campusId, amount, channel: 'bank_transfer', status: 'pending_reconciliation',
        imagePath, note: typeof p?.note === 'string' ? p.note.slice(0, 500) : null, submittedBy: ctx.uid, submittedAt: firebase_1.Timestamp.now(), allocatedAmount: 0, opId: ctx.opId,
    });
    const rs = (0, common_1.asDocs)(await ctx.col('receivables').where('childId', '==', childId).where('status', 'in', [...finance_common_1.OPEN_STATUSES]).get());
    for (const r of rs)
        await ctx.doc(`receivables/${r.id}`).update({ pendingReconciliation: true });
    return { id, status: 'pending_reconciliation', note: 'Đã gửi minh chứng. Khoản phải thu chỉ được ghi nhận sau khi kế toán đối soát.' };
};
async function clearPendingFlag(ctx, childId) {
    const others = (0, common_1.asDocs)(await ctx.col('payments').where('childId', '==', childId).where('status', '==', 'pending_reconciliation').get());
    if (others.length)
        return;
    const rs = (0, common_1.asDocs)(await ctx.col('receivables').where('childId', '==', childId).where('status', 'in', [...finance_common_1.OPEN_STATUSES]).get());
    for (const r of rs)
        if (r.pendingReconciliation)
            await ctx.doc(`receivables/${r.id}`).update({ pendingReconciliation: false });
}
// ---------------------------------------------------------------- bank.import
const bankImport = async (ctx, p) => {
    const { id: campusId, campus } = await (0, common_1.resolveCampus)(ctx, p, 'payments.reconcile');
    const rows = Array.isArray(p?.rows) ? p.rows : [];
    if (!rows.length)
        (0, errors_1.invalid)({ rows: 'Chưa có dòng giao dịch.' });
    if (rows.length > 1000)
        (0, errors_1.fail)('LIMIT', 'Tối đa 1000 dòng một lần nhập.');
    const tz = (0, common_1.tzOf)(campus);
    const children = (0, common_1.asDocs)(await ctx.col('children').where('campusId', '==', campusId).get()).filter((c) => c.code && !c.archived);
    const results = [];
    const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i] ?? {};
        const source = typeof r.source === 'string' ? r.source.trim() : '';
        const txnCode = typeof r.txnCode === 'string' ? r.txnCode.trim() : String(r.txnCode ?? '').trim();
        const key = `${source}_${txnCode}`;
        const at = (0, common_1.toDate)(r.at);
        if (!source || !txnCode || !toSafeKey(key)) {
            results.push({ index: i, result: 'error', message: 'Thiếu/không hợp lệ nguồn hoặc mã giao dịch.' });
            continue;
        }
        if (!Number.isSafeInteger(r.amount) || r.amount <= 0) {
            results.push({ index: i, key, result: 'ignored', message: 'Bỏ qua: không phải khoản tiền vào hợp lệ (số nguyên đồng > 0).' });
            continue;
        }
        if (!at) {
            results.push({ index: i, key, result: 'error', message: 'Thời điểm giao dịch không hợp lệ.' });
            continue;
        }
        const content = typeof r.content === 'string' ? r.content.slice(0, 500) : '';
        const tref = ctx.doc(`bankTransactions/${key}`);
        try {
            await tref.create({
                campusId, source, txnCode, amount: r.amount, at: firebase_1.Timestamp.fromDate(at), content, account: r.account ?? null, status: 'unmatched', importedBy: ctx.uid, ...ctx.metaCreate(),
            });
        }
        catch (e) {
            if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) {
                results.push({ index: i, key, result: 'duplicate', message: 'Giao dịch trùng (cùng nguồn và mã); không ghi thu lần hai.' });
                continue;
            }
            throw e;
        }
        // Ghép tự động CHỈ khi nội dung chứa đúng một mã trẻ (không ghép theo tên).
        let matched = null;
        if (p?.autoMatch !== false) {
            const text = ` ${norm(content)} `;
            const hits = children.filter((c) => text.includes(` ${norm(String(c.code))} `));
            if (hits.length === 1)
                matched = hits[0];
        }
        if (!matched) {
            results.push({ index: i, key, result: 'imported_unmatched', message: 'Chưa xác định học sinh; chờ đối soát.' });
            continue;
        }
        try {
            const pr = await applyConfirmedPayment(ctx, {
                paymentId: key, childId: matched.id, campusId, tz, amount: r.amount, channel: 'bank_transfer', at,
                fields: { reference: txnCode, source, note: content, bankTxnId: key, account: r.account ?? null, childName: (0, finance_common_1.childName)(matched), autoMatched: true }, mode: 'create',
            });
            await tref.update({ status: 'matched', childId: matched.id, paymentId: key, matchedAt: firebase_1.Timestamp.now(), matchedBy: ctx.uid });
            results.push({ index: i, key, result: 'imported_matched', paymentId: key, message: `Đã ghi thu cho ${(0, finance_common_1.childName)(matched)}; phân bổ ${pr.allocatedAmount}, dư ${pr.credit}.` });
        }
        catch (e) {
            results.push({ index: i, key, result: 'imported_unmatched', message: `Chưa tự ghi thu được: ${e?.message ?? 'lỗi'}` });
        }
    }
    const count = (k) => results.filter((x) => x.result === k).length;
    await ctx.audit({ action: 'bank.import', collection: 'bankTransactions', campusId, after: { rows: rows.length, matched: count('imported_matched'), unmatched: count('imported_unmatched'), duplicate: count('duplicate') } });
    return { total: rows.length, matched: count('imported_matched'), unmatched: count('imported_unmatched'), duplicate: count('duplicate'), errors: count('error'), ignored: count('ignored'), results };
};
// ---------------------------------------------------------------- payment.reconcile
const paymentReconcile = async (ctx, p) => {
    const decision = p?.decision === 'reject' ? 'reject' : 'confirm';
    const note = typeof p?.note === 'string' ? p.note.slice(0, 500) : undefined;
    if (p?.paymentId) {
        const pay = await (0, common_1.getInCampus)(ctx, 'payments', p.paymentId, null, 'Giao dịch');
        ctx.require('payments.reconcile', pay.campusId);
        if (pay.status !== 'pending_reconciliation')
            (0, errors_1.fail)('INVALID_STATE', 'Giao dịch không ở trạng thái chờ đối soát.');
        if (decision === 'reject') {
            await (0, store_1.updateDoc)(ctx, ctx.doc(`payments/${pay.id}`), { status: 'rejected', rejectedBy: ctx.uid, rejectedAt: firebase_1.Timestamp.now(), rejectReason: note ?? null });
            await clearPendingFlag(ctx, pay.childId);
            await ctx.audit({ action: 'payment.reconcile.reject', collection: 'payments', docId: pay.id, campusId: pay.campusId, reason: note });
            return { paymentId: pay.id, status: 'rejected' };
        }
        const campus = await (0, store_1.getCampus)(ctx, pay.campusId);
        let bank = null;
        if (p?.bankTxnId) {
            bank = await (0, common_1.getInCampus)(ctx, 'bankTransactions', p.bankTxnId, pay.campusId, 'Giao dịch ngân hàng');
            if (bank.status !== 'unmatched')
                (0, errors_1.fail)('INVALID_STATE', 'Giao dịch ngân hàng này đã được ghép.');
            if (bank.amount !== pay.amount)
                (0, errors_1.fail)('PRECONDITION', `Số tiền ngân hàng (${bank.amount}) khác số tiền trên minh chứng (${pay.amount}).`, { reason: 'AMOUNT_MISMATCH' });
        }
        else if (!note)
            (0, errors_1.invalid)({ note: 'Xác nhận thủ công (không có giao dịch ngân hàng) phải ghi lý do/căn cứ đối soát.' });
        const r = await applyConfirmedPayment(ctx, {
            paymentId: pay.id, childId: pay.childId, campusId: pay.campusId, tz: (0, common_1.tzOf)(campus), amount: pay.amount, channel: pay.channel ?? 'bank_transfer',
            at: (0, common_1.toDate)(bank?.at) ?? ctx.now, manual: parseManual(p?.allocations),
            fields: { reference: bank?.txnCode ?? pay.reference ?? null, bankTxnId: bank?.id ?? null, reconcileNote: note ?? null, reconciledBy: ctx.uid }, mode: 'confirm_pending',
        });
        if (bank)
            await ctx.doc(`bankTransactions/${bank.id}`).update({ status: 'matched', childId: pay.childId, paymentId: pay.id, matchedAt: firebase_1.Timestamp.now(), matchedBy: ctx.uid });
        await clearPendingFlag(ctx, pay.childId);
        await ctx.audit({ action: 'payment.reconcile', collection: 'payments', docId: pay.id, campusId: pay.campusId, reason: note, after: r });
        return r;
    }
    // Giao dịch ngân hàng chưa xác định → gán cho trẻ.
    const bank = await (0, common_1.getInCampus)(ctx, 'bankTransactions', p?.bankTxnId, null, 'Giao dịch ngân hàng');
    ctx.require('payments.reconcile', bank.campusId);
    if (bank.status !== 'unmatched')
        (0, errors_1.fail)('INVALID_STATE', 'Giao dịch ngân hàng này đã được ghép.');
    if (decision === 'reject') {
        await ctx.doc(`bankTransactions/${bank.id}`).update({ status: 'ignored', ignoredBy: ctx.uid, ignoredAt: firebase_1.Timestamp.now(), ignoreReason: note ?? null });
        return { bankTxnId: bank.id, status: 'ignored' };
    }
    const child = await childOf(ctx, p?.childId);
    if (child.campusId !== bank.campusId)
        (0, errors_1.fail)('PRECONDITION', 'Trẻ không thuộc cơ sở nhận giao dịch này. Cần luồng chuyển/đảo đúng nơi phát sinh.', { reason: 'WRONG_CAMPUS' });
    const campus = await (0, store_1.getCampus)(ctx, bank.campusId);
    const r = await applyConfirmedPayment(ctx, {
        paymentId: bank.id, childId: child.id, campusId: bank.campusId, tz: (0, common_1.tzOf)(campus), amount: bank.amount, channel: 'bank_transfer', at: (0, common_1.toDate)(bank.at) ?? ctx.now,
        manual: parseManual(p?.allocations), fields: { reference: bank.txnCode, source: bank.source, note: bank.content, bankTxnId: bank.id, childName: (0, finance_common_1.childName)(child) }, mode: 'create',
    });
    await ctx.doc(`bankTransactions/${bank.id}`).update({ status: 'matched', childId: child.id, paymentId: bank.id, matchedAt: firebase_1.Timestamp.now(), matchedBy: ctx.uid });
    await ctx.audit({ action: 'payment.reconcile.assign', collection: 'bankTransactions', docId: bank.id, campusId: bank.campusId, after: r });
    return r;
};
// ---------------------------------------------------------------- payment.cancel (đảo bút toán)
async function reversePayment(ctx, paymentId, reason, viaApproval) {
    const pay = await (0, common_1.getInCampus)(ctx, 'payments', paymentId, null, 'Giao dịch');
    ctx.require('billing.approve', pay.campusId);
    if (pay.status !== 'confirmed' || pay.type !== 'receipt')
        (0, errors_1.fail)('INVALID_STATE', 'Chỉ hủy được phiếu thu đã ghi nhận và chưa bị đảo.');
    const campus = await (0, store_1.getCampus)(ctx, pay.campusId);
    const today = todayOf(ctx, campus);
    const res = await ctx.tx(async (t) => {
        const [als, cr] = await Promise.all([t.get(ctx.col('allocations').where('paymentId', '==', paymentId)), t.get(ctx.doc(`credits/${paymentId}`))]);
        const allocs = als.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.kind === 'payment');
        if (cr.exists && (cr.data()?.remaining ?? 0) < (cr.data()?.amount ?? 0))
            (0, errors_1.fail)('PRECONDITION', 'Khoản dư của phiếu thu này đã được sử dụng/hoàn; xử lý hoàn trước khi hủy.', { reason: 'CREDIT_USED' });
        const rrefs = allocs.map((a) => ctx.doc(`receivables/${a.receivableId}`));
        const rsnaps = await Promise.all(rrefs.map((r) => t.get(r)));
        const now = firebase_1.Timestamp.now();
        allocs.forEach((a, i) => {
            const r = { id: rsnaps[i].id, ...rsnaps[i].data() };
            const st = (0, finance_common_1.rcvState)(r, { allocated: Math.max(0, (r.allocated ?? 0) - a.amount) }, today);
            t.update(rrefs[i], (0, finance_common_1.patchOf)(ctx, r.version, { allocated: st.allocated, balance: st.balance, status: st.status, isOverdue: st.isOverdue }));
            t.set(ctx.doc(`allocations/rev_${paymentId}_${a.receivableId}`), { paymentId: `rev_${paymentId}`, reversesPaymentId: paymentId, receivableId: a.receivableId, childId: pay.childId, campusId: pay.campusId, periodKey: a.periodKey ?? null, amount: -a.amount, kind: 'reversal', at: now, ...ctx.metaCreate() });
        });
        if (cr.exists)
            t.update(ctx.doc(`credits/${paymentId}`), (0, finance_common_1.patchOf)(ctx, cr.data()?.version, { remaining: 0, status: 'reversed' }));
        t.update(ctx.doc(`payments/${paymentId}`), (0, finance_common_1.patchOf)(ctx, pay.version, { status: 'reversed', reversedAt: now, reversedBy: ctx.uid, reverseReason: reason, reversalId: `rev_${paymentId}` }));
        t.set(ctx.doc(`payments/rev_${paymentId}`), { type: 'reversal', sign: -1, reversesId: paymentId, childId: pay.childId, campusId: pay.campusId, amount: pay.amount, channel: pay.channel, status: 'confirmed', reason, receivedAt: now, ...ctx.metaCreate() });
        t.set(ctx.doc(`cashLedger/payment_rev_${paymentId}`), (0, ledger_1.ledgerData)(ctx, { campusId: pay.campusId, dir: 'out', amount: pay.amount, channel: pay.channel, refType: 'payment_reversal', refId: paymentId, childId: pay.childId, tz: (0, common_1.tzOf)(campus) }));
        if (pay.bankTxnId)
            t.update(ctx.doc(`bankTransactions/${pay.bankTxnId}`), { reversed: true, status: 'reversed' });
        return { reversed: allocs.reduce((s, a) => s + a.amount, 0) };
    });
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'payments', paymentId, 'approved', reason);
    await ctx.audit({ action: 'payment.cancel.apply', collection: 'payments', docId: paymentId, campusId: pay.campusId, reason, after: { reversalId: `rev_${paymentId}`, ...res } });
    return { paymentId, status: 'reversed', reversalId: `rev_${paymentId}`, ...res };
}
(0, approvals_1.registerApprovalHandler)('payment_cancel', {
    perm: 'billing.approve',
    onApprove: (ctx, a) => reversePayment(ctx, a.refId, String(a.payload?.reason ?? a.summary), true),
    onReject: async (ctx, a, note) => { await ctx.doc(`payments/${a.refId}`).update({ 'cancelRequest.status': 'rejected', 'cancelRequest.note': note ?? null }); return { rejected: true }; },
});
const paymentCancel = async (ctx, p) => {
    const pay = await (0, common_1.getInCampus)(ctx, 'payments', p?.paymentId, null, 'Giao dịch');
    ctx.require('payments.write', pay.campusId);
    const reason = (0, common_1.needStr)(p?.reason, 'reason', 500);
    if (pay.status !== 'confirmed' || pay.type !== 'receipt')
        (0, errors_1.fail)('INVALID_STATE', 'Chỉ hủy được phiếu thu đã ghi nhận và chưa bị đảo.');
    if (pay.cancelRequest?.status === 'pending')
        (0, errors_1.fail)('CONFLICT', 'Đã có yêu cầu hủy đang chờ duyệt.');
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'payment_cancel', campusId: pay.campusId, refCollection: 'payments', refId: pay.id, payload: { reason },
        summary: `Hủy phiếu thu ${pay.amount} của ${pay.childName ?? pay.childId}`, impact: { amount: pay.amount, allocations: pay.allocations ?? [], credit: pay.creditAmount ?? 0, effect: 'Tạo bút toán đảo; công nợ tăng lại tương ứng.' },
    });
    await ctx.doc(`payments/${pay.id}`).update({ cancelRequest: { status: 'pending', reason, requestedBy: ctx.uid, approvalId, at: firebase_1.Timestamp.now() } });
    await ctx.audit({ action: 'payment.cancel.request', collection: 'payments', docId: pay.id, campusId: pay.campusId, reason });
    return { paymentId: pay.id, approvalId, status: 'pending' };
};
// ---------------------------------------------------------------- refunds
async function creditAvailable(ctx, childId, campusId) {
    return (0, common_1.asDocs)(await ctx.col('credits').where('childId', '==', childId).where('status', '==', 'open').get()).filter((c) => c.campusId === campusId).reduce((s, c) => s + c.remaining, 0);
}
const refundRequest = async (ctx, p) => {
    const child = await childOf(ctx, p?.childId);
    ctx.require('payments.write', child.campusId);
    const amount = (0, common_1.needVnd)(p?.amount);
    const reason = (0, common_1.needStr)(p?.reason, 'reason', 500);
    const avail = await creditAvailable(ctx, child.id, child.campusId);
    if (amount > avail)
        (0, errors_1.fail)('PRECONDITION', `Số dư có của phụ huynh chỉ ${avail}; không thể hoàn ${amount}. Điều chỉnh giảm khoản phải thu (receivable.adjust) để tạo số dư trước.`, { available: avail, reason: 'INSUFFICIENT_CREDIT' });
    const id = await (0, store_1.createDoc)(ctx, 'refunds', undefined, { childId: child.id, childName: (0, finance_common_1.childName)(child), campusId: child.campusId, amount, reason, method: p?.method === 'cash' ? 'cash' : 'bank_transfer', status: 'requested' });
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'refund', campusId: child.campusId, refCollection: 'refunds', refId: id,
        summary: `Hoàn ${amount} cho ${(0, finance_common_1.childName)(child)}`, impact: { amount, creditAvailable: avail, effect: 'Duyệt KHÔNG đồng nghĩa đã chi; chi trả ghi nhận riêng ở refund.pay.' },
    });
    await ctx.doc(`refunds/${id}`).update({ approvalId });
    await ctx.audit({ action: 'refund.request', collection: 'refunds', docId: id, campusId: child.campusId, reason, after: { amount } });
    return { id, approvalId, status: 'requested' };
};
async function decideRefund(ctx, id, decision, note, viaApproval) {
    const rf = await (0, common_1.getInCampus)(ctx, 'refunds', id, null, 'Yêu cầu hoàn tiền');
    ctx.require('refunds.approve', rf.campusId);
    if (rf.status !== 'requested')
        (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu hoàn tiền đã được xử lý.');
    (0, common_1.separateDuties)(ctx, rf.createdBy, 'yêu cầu hoàn tiền');
    if (decision === 'approved') {
        const avail = await creditAvailable(ctx, rf.childId, rf.campusId);
        if (rf.amount > avail)
            (0, errors_1.fail)('PRECONDITION', `Số dư có hiện chỉ ${avail}.`, { available: avail });
    }
    await (0, store_1.updateDoc)(ctx, ctx.doc(`refunds/${id}`), { status: decision, decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null });
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'refunds', id, decision, note);
    await ctx.audit({ action: `refund.${decision}`, collection: 'refunds', docId: id, campusId: rf.campusId, reason: note, after: { amount: rf.amount } });
    return { id, status: decision };
}
(0, approvals_1.registerApprovalHandler)('refund', {
    perm: 'refunds.approve',
    onApprove: (ctx, a, note) => decideRefund(ctx, a.refId, 'approved', note, true),
    onReject: (ctx, a, note) => decideRefund(ctx, a.refId, 'rejected', note, true),
});
const refundPay = async (ctx, p) => {
    const rf = await (0, common_1.getInCampus)(ctx, 'refunds', p?.id, null, 'Yêu cầu hoàn tiền');
    ctx.require('payments.write', rf.campusId);
    if (rf.status !== 'approved')
        (0, errors_1.fail)('INVALID_STATE', rf.status === 'paid' ? 'Khoản hoàn này đã chi trả.' : 'Chỉ chi trả khoản hoàn đã được duyệt.');
    const campus = await (0, store_1.getCampus)(ctx, rf.campusId);
    const method = p?.method === 'cash' ? 'cash' : 'bank_transfer';
    const at = (0, common_1.toDate)(p?.paidAt) ?? ctx.now;
    await ctx.tx(async (t) => {
        const [rs, cs] = await Promise.all([t.get(ctx.doc(`refunds/${rf.id}`)), t.get(ctx.col('credits').where('childId', '==', rf.childId).where('status', '==', 'open'))]);
        if (rs.data()?.status !== 'approved')
            (0, errors_1.fail)('INVALID_STATE', 'Khoản hoàn không còn ở trạng thái đã duyệt.');
        const credits = cs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.campusId === rf.campusId).sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        let need = rf.amount;
        for (const c of credits) {
            if (need <= 0)
                break;
            const take = Math.min(c.remaining, need);
            need -= take;
            t.update(ctx.doc(`credits/${c.id}`), (0, finance_common_1.patchOf)(ctx, c.version, { remaining: c.remaining - take, status: c.remaining - take === 0 ? 'used' : 'open' }));
        }
        if (need > 0)
            (0, errors_1.fail)('PRECONDITION', 'Số dư có không còn đủ để chi hoàn.', { missing: need });
        const now = firebase_1.Timestamp.now();
        t.update(ctx.doc(`refunds/${rf.id}`), (0, finance_common_1.patchOf)(ctx, rs.data()?.version, { status: 'paid', paidAt: firebase_1.Timestamp.fromDate(at), paidBy: ctx.uid, payMethod: method, payReference: p?.reference ?? null, payOpId: ctx.opId }));
        // Ghi giao dịch TIỀN RA (không chỉ đổi trạng thái).
        t.set(ctx.doc(`payments/rf_${rf.id}`), { type: 'refund', sign: -1, refundId: rf.id, childId: rf.childId, campusId: rf.campusId, amount: rf.amount, channel: method, reference: p?.reference ?? null, status: 'confirmed', receivedAt: now, ...ctx.metaCreate() });
        t.set(ctx.doc(`cashLedger/refund_${rf.id}`), (0, ledger_1.ledgerData)(ctx, { campusId: rf.campusId, dir: 'out', amount: rf.amount, channel: method, refType: 'refund', refId: rf.id, childId: rf.childId, at, tz: (0, common_1.tzOf)(campus) }));
    });
    await ctx.audit({ action: 'refund.pay', collection: 'refunds', docId: rf.id, campusId: rf.campusId, after: { amount: rf.amount, method } });
    return { id: rf.id, status: 'paid', amount: rf.amount };
};
const refundApprove = async (ctx, p) => decideRefund(ctx, p?.id, (0, common_1.needDecision)(p?.decision ?? 'approved'), p?.note, false);
// ---------------------------------------------------------------- receivable.adjust
const receivableAdjust = async (ctx, p) => {
    const r = await (0, common_1.getInCampus)(ctx, 'receivables', p?.receivableId, null, 'Khoản phải thu');
    ctx.require('billing.write', r.campusId);
    if (!Number.isSafeInteger(p?.amount) || p.amount === 0)
        (0, errors_1.invalid)({ amount: 'Số tiền điều chỉnh phải là số nguyên đồng khác 0 (dương = tăng, âm = giảm).' });
    const reason = (0, common_1.needStr)(p?.reason, 'reason', 500);
    if (['draft', 'cancelled'].includes(r.status))
        (0, errors_1.fail)('INVALID_STATE', r.status === 'draft' ? 'Khoản chưa phát hành: tính lại bằng billing.run, không dùng điều chỉnh.' : 'Khoản đã hủy.');
    const net = (r.billed ?? 0) + (r.adjustUp ?? 0) - (r.discount ?? 0);
    if (p.amount < 0 && net + p.amount < 0)
        (0, errors_1.invalid)({ amount: `Không thể giảm quá giá trị khoản phải thu (${net}).` });
    const id = await (0, store_1.createDoc)(ctx, 'receivableAdjustments', undefined, {
        adjustsId: r.id, receivableId: r.id, childId: r.childId, campusId: r.campusId, amount: p.amount, kind: p.amount > 0 ? 'increase' : 'decrease', reason,
        evidencePaths: Array.isArray(p?.evidencePaths) ? p.evidencePaths.slice(0, 10) : [], status: 'pending',
    });
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'receivable_adjust', campusId: r.campusId, refCollection: 'receivableAdjustments', refId: id,
        summary: `${p.amount > 0 ? 'Tăng' : 'Giảm'} ${Math.abs(p.amount)} khoản ${r.periodKey} của ${r.childName ?? r.childId}`, impact: { receivableId: r.id, amount: p.amount, balanceBefore: r.balance, balanceAfter: Math.max(0, r.balance + p.amount) },
    });
    await ctx.doc(`receivableAdjustments/${id}`).update({ approvalId });
    await ctx.audit({ action: 'receivable.adjust.request', collection: 'receivableAdjustments', docId: id, campusId: r.campusId, reason, after: { receivableId: r.id, amount: p.amount } });
    return { id, approvalId, status: 'pending' };
};
async function applyAdjust(ctx, id, decision, note) {
    const adj = await (0, common_1.getInCampus)(ctx, 'receivableAdjustments', id, null, 'Chứng từ điều chỉnh');
    ctx.require('billing.approve', adj.campusId);
    if (adj.status !== 'pending')
        (0, errors_1.fail)('INVALID_STATE', 'Chứng từ điều chỉnh đã được xử lý.');
    (0, common_1.separateDuties)(ctx, adj.createdBy, 'chứng từ điều chỉnh');
    if (decision === 'rejected') {
        await (0, store_1.updateDoc)(ctx, ctx.doc(`receivableAdjustments/${id}`), { status: 'rejected', decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null });
        return { id, status: 'rejected' };
    }
    const campus = await (0, store_1.getCampus)(ctx, adj.campusId);
    const today = todayOf(ctx, campus);
    const out = await ctx.tx(async (t) => {
        const rref = ctx.doc(`receivables/${adj.receivableId}`);
        const [rs, as] = await Promise.all([t.get(rref), t.get(ctx.doc(`receivableAdjustments/${id}`))]);
        if (as.data()?.status !== 'pending')
            (0, errors_1.fail)('INVALID_STATE', 'Chứng từ điều chỉnh đã được xử lý.');
        const r = { id: rs.id, ...rs.data() };
        const adjustUp = (r.adjustUp ?? 0) + (adj.amount > 0 ? adj.amount : 0);
        const discount = (r.discount ?? 0) + (adj.amount < 0 ? -adj.amount : 0);
        const net = (r.openingDebt ?? 0) + (r.billed ?? 0) + adjustUp - discount;
        let allocated = r.allocated ?? 0;
        let excess = 0;
        if (allocated > net) {
            excess = allocated - net;
            allocated = net;
        } // đã thu nhiều hơn → chuyển phần dư sang số dư có
        const st = (0, finance_common_1.rcvState)(r, { adjustUp, discount, allocated }, today);
        const now = firebase_1.Timestamp.now();
        t.update(rref, (0, finance_common_1.patchOf)(ctx, r.version, { adjustUp, discount, allocated: st.allocated, balance: st.balance, status: st.status, isOverdue: st.isOverdue }));
        if (excess > 0) {
            t.set(ctx.doc(`credits/adj_${id}`), { childId: r.childId, campusId: r.campusId, adjustmentId: id, amount: excess, remaining: excess, status: 'open', ...ctx.metaCreate() });
            t.set(ctx.doc(`allocations/adj_${id}_${r.id}`), { paymentId: `adj_${id}`, adjustmentId: id, receivableId: r.id, childId: r.childId, campusId: r.campusId, periodKey: r.periodKey, amount: -excess, kind: 'adjustment_credit', at: now, ...ctx.metaCreate() });
        }
        t.update(ctx.doc(`receivableAdjustments/${id}`), (0, finance_common_1.patchOf)(ctx, as.data()?.version, { status: 'applied', decidedBy: ctx.uid, decidedAt: now, decisionNote: note ?? null, balanceAfter: st.balance, creditCreated: excess }));
        return { balance: st.balance, status: st.status, creditCreated: excess };
    });
    await ctx.audit({ action: 'receivable.adjust.apply', collection: 'receivableAdjustments', docId: id, campusId: adj.campusId, reason: note, after: { receivableId: adj.receivableId, amount: adj.amount, ...out } });
    return { ...out, id, status: 'applied', accountStatus: out.status };
}
(0, approvals_1.registerApprovalHandler)('receivable_adjust', {
    perm: 'billing.approve',
    onApprove: (ctx, a, note) => applyAdjust(ctx, a.refId, 'approved', note),
    onReject: (ctx, a, note) => applyAdjust(ctx, a.refId, 'rejected', note),
});
// ---------------------------------------------------------------- expenses
const expenseRequest = async (ctx, p) => {
    let doc;
    if (p?.id) {
        doc = await (0, common_1.getInCampus)(ctx, 'expenses', p.id, null, 'Đề nghị chi');
        ctx.require('expenses.write', doc.campusId);
        if (!['draft', 'rejected'].includes(doc.status))
            (0, errors_1.fail)('INVALID_STATE', 'Đề nghị chi đã gửi.');
    }
    else {
        const { id: campusId } = await (0, common_1.resolveCampus)(ctx, p, 'expenses.write');
        const d = (0, validate_1.validate)(p, {
            category: { t: 'string', req: true, max: 60 }, amount: { t: 'int', req: true, min: 1, max: 10_000_000_000 }, description: { t: 'string', req: true, max: 500 },
            vendor: { t: 'string', max: 150 }, expenseDate: { t: 'day' }, evidencePaths: { t: 'array', max: 10 },
        });
        const id = await (0, store_1.createDoc)(ctx, 'expenses', undefined, { ...d, campusId, status: 'draft' });
        doc = await (0, common_1.getInCampus)(ctx, 'expenses', id, campusId, 'Đề nghị chi');
    }
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'expense', campusId: doc.campusId, refCollection: 'expenses', refId: doc.id,
        summary: `Đề nghị chi ${doc.amount} — ${doc.category}: ${doc.description}`, impact: { amount: doc.amount, category: doc.category },
    });
    await (0, store_1.updateDoc)(ctx, ctx.doc(`expenses/${doc.id}`), { status: 'requested', requestedBy: ctx.uid, requestedAt: firebase_1.Timestamp.now(), approvalId });
    await ctx.audit({ action: 'expense.request', collection: 'expenses', docId: doc.id, campusId: doc.campusId, after: { amount: doc.amount } });
    return { id: doc.id, approvalId, status: 'requested' };
};
async function decideExpense(ctx, id, decision, note, viaApproval) {
    const ex = await (0, common_1.getInCampus)(ctx, 'expenses', id, null, 'Đề nghị chi');
    ctx.require('expenses.approve', ex.campusId);
    if (ex.status !== 'requested')
        (0, errors_1.fail)('INVALID_STATE', 'Đề nghị chi đã được xử lý hoặc chưa gửi.');
    (0, common_1.separateDuties)(ctx, ex.requestedBy ?? ex.createdBy, 'đề nghị chi'); // tách người lập / người duyệt
    if (decision === 'approved') {
        const campus = await (0, store_1.getCampus)(ctx, ex.campusId);
        const limit = campus.expenseLimit;
        // Hạn mức duyệt của cơ sở: vượt hạn mức cần người duyệt cấp toàn tổ chức.
        if (typeof limit === 'number' && ex.amount > limit && !ctx.can('expenses.approve', '*'))
            (0, errors_1.fail)('LIMIT', `Khoản chi ${ex.amount} vượt hạn mức duyệt của cơ sở (${limit}); cần cấp duyệt cao hơn.`, { limit });
    }
    await (0, store_1.updateDoc)(ctx, ctx.doc(`expenses/${id}`), { status: decision === 'approved' ? 'approved' : 'rejected', decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null });
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'expenses', id, decision, note);
    await ctx.audit({ action: `expense.${decision}`, collection: 'expenses', docId: id, campusId: ex.campusId, reason: note, after: { amount: ex.amount } });
    return { id, status: decision === 'approved' ? 'approved' : 'rejected' };
}
(0, approvals_1.registerApprovalHandler)('expense', {
    perm: 'expenses.approve',
    onApprove: (ctx, a, note) => decideExpense(ctx, a.refId, 'approved', note, true),
    onReject: (ctx, a, note) => decideExpense(ctx, a.refId, 'rejected', note, true),
});
const expensePay = async (ctx, p) => {
    const ex = await (0, common_1.getInCampus)(ctx, 'expenses', p?.id, null, 'Đề nghị chi');
    ctx.require('expenses.write', ex.campusId);
    if (ex.status !== 'approved')
        (0, errors_1.fail)('INVALID_STATE', ex.status === 'paid' ? 'Khoản chi đã thanh toán.' : 'Chỉ thanh toán khoản chi đã được duyệt.');
    const campus = await (0, store_1.getCampus)(ctx, ex.campusId);
    const method = p?.method === 'cash' ? 'cash' : 'bank_transfer';
    const at = (0, common_1.toDate)(p?.paidAt) ?? ctx.now;
    await ctx.tx(async (t) => {
        const s = await t.get(ctx.doc(`expenses/${ex.id}`));
        if (s.data()?.status !== 'approved')
            (0, errors_1.fail)('INVALID_STATE', 'Khoản chi không còn ở trạng thái đã duyệt.');
        t.update(ctx.doc(`expenses/${ex.id}`), (0, finance_common_1.patchOf)(ctx, s.data()?.version, { status: 'paid', paidAt: firebase_1.Timestamp.fromDate(at), paidBy: ctx.uid, payMethod: method, payReference: p?.reference ?? null, payEvidencePaths: Array.isArray(p?.evidencePaths) ? p.evidencePaths.slice(0, 10) : [] }));
        t.set(ctx.doc(`cashLedger/expense_${ex.id}`), (0, ledger_1.ledgerData)(ctx, { campusId: ex.campusId, dir: 'out', amount: ex.amount, channel: method, refType: 'expense', refId: ex.id, at, tz: (0, common_1.tzOf)(campus) }));
    });
    await ctx.audit({ action: 'expense.pay', collection: 'expenses', docId: ex.id, campusId: ex.campusId, after: { amount: ex.amount, method } });
    return { id: ex.id, status: 'paid' };
};
const expenseApprove = async (ctx, p) => decideExpense(ctx, p?.id, (0, common_1.needDecision)(p?.decision ?? 'approved'), p?.note, false);
// ---------------------------------------------------------------- fund.reconcile
const fundReconcile = async (ctx, p) => {
    const { id: campusId } = await (0, common_1.resolveCampus)(ctx, p, 'payments.reconcile');
    const channel = p?.channel === 'bank_transfer' ? 'bank_transfer' : 'cash';
    const upto = (0, common_1.needDay)(p?.dayKey ?? p?.upto, 'dayKey');
    const counted = (0, common_1.needVnd)(p?.countedAmount, 'countedAmount', { allowZero: true });
    const prev = (0, common_1.asDocs)(await ctx.col('fundReconciliations').where('campusId', '==', campusId).where('channel', '==', channel).get()).sort((a, b) => b.upto.localeCompare(a.upto))[0];
    if (prev && prev.upto >= upto)
        (0, errors_1.invalid)({ dayKey: `Đã đối chiếu quỹ đến ${prev.upto}; chọn ngày sau đó.` });
    const opening = prev ? prev.counted : (Number.isSafeInteger(p?.openingBalance) ? p.openingBalance : 0);
    const led = (0, common_1.asDocs)(await ctx.col('cashLedger').where('campusId', '==', campusId).where('dayKey', '<=', upto).get()).filter((l) => l.channel === channel && (!prev || l.dayKey > prev.upto));
    const inAmt = led.filter((l) => l.dir === 'in').reduce((s, l) => s + l.amount, 0);
    const outAmt = led.filter((l) => l.dir === 'out').reduce((s, l) => s + l.amount, 0);
    const expected = opening + inAmt - outAmt;
    const variance = counted - expected;
    const note = typeof p?.note === 'string' ? p.note.slice(0, 500) : null;
    if (variance !== 0 && !note)
        (0, errors_1.invalid)({ note: `Chênh lệch ${variance}: ghi giải trình.` });
    const id = await (0, store_1.createDoc)(ctx, 'fundReconciliations', undefined, { campusId, channel, upto, previousId: prev?.id ?? null, openingBalance: opening, inAmount: inAmt, outAmount: outAmt, expected, counted, variance, status: variance === 0 ? 'matched' : 'variance', note, entryCount: led.length });
    await ctx.audit({ action: 'fund.reconcile', collection: 'fundReconciliations', docId: id, campusId, after: { channel, upto, expected, counted, variance } });
    return { id, expected, counted, variance, status: variance === 0 ? 'matched' : 'variance', inAmount: inAmt, outAmount: outAmt, openingBalance: opening };
};
exports.actions = {
    'payment.record': { scope: 'org', perm: 'payments.write', idempotent: true, handler: paymentRecord },
    'payment.submitProof': { scope: 'org', kinds: ['parent'], idempotent: true, handler: paymentSubmitProof },
    'payment.reconcile': { scope: 'org', perm: 'payments.reconcile', handler: paymentReconcile },
    'bank.import': { scope: 'org', perm: 'payments.reconcile', handler: bankImport },
    'payment.cancel': { scope: 'org', perm: 'payments.write', handler: paymentCancel },
    'refund.request': { scope: 'org', perm: 'payments.write', handler: refundRequest },
    'refund.approve': { scope: 'org', perm: 'refunds.approve', handler: refundApprove },
    'refund.pay': { scope: 'org', perm: 'payments.write', idempotent: true, handler: refundPay },
    'receivable.adjust': { scope: 'org', perm: 'billing.write', handler: receivableAdjust },
    'expense.request': { scope: 'org', perm: 'expenses.write', handler: expenseRequest },
    'expense.approve': { scope: 'org', perm: 'expenses.approve', handler: expenseApprove },
    'expense.pay': { scope: 'org', perm: 'expenses.write', idempotent: true, handler: expensePay },
    'fund.reconcile': { scope: 'org', perm: 'payments.reconcile', handler: fundReconcile },
};
