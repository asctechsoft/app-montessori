"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const approvals_1 = require("../core/approvals");
const validate_1 = require("../core/validate");
const common_1 = require("../lib/common");
const calc_pay_1 = require("../lib/calc-pay");
const hr_common_1 = require("../lib/hr-common");
const time_1 = require("../lib/time");
const ledger_1 = require("../lib/ledger");
const hr_common_2 = require("../lib/hr-common");
const COMPONENT_TYPES = ['allowance', 'bonus', 'deduction', 'advance'];
const salarySave = async (ctx, p) => {
    const empSnap = await (0, common_1.getInCampus)(ctx, 'employees', p?.employeeId, null, 'Nhân viên');
    const campusId = empSnap.campusId;
    ctx.require('payroll.write', campusId);
    const d = (0, validate_1.validate)(p, {
        baseSalary: { t: 'int', req: true, min: 0, max: 10_000_000_000 }, overtimeRate: { t: 'number', min: 1, max: 5 },
        effectiveFrom: { t: 'day' }, note: { t: 'string', max: 500 },
    });
    const comps = Array.isArray(p?.components) ? p.components : [];
    if (comps.length > 50)
        (0, errors_1.invalid)({ components: 'Tối đa 50 thành phần lương.' });
    const components = comps.map((c, i) => {
        let v;
        try {
            v = (0, validate_1.validate)(c, {
                code: { t: 'string', req: true, max: 30 }, name: { t: 'string', req: true, max: 100 },
                type: { t: 'string', req: true, oneOf: COMPONENT_TYPES }, calc: { t: 'string', oneOf: ['fixed', 'per_paid_day', 'percent_of_base_pay'] },
                amount: { t: 'int', min: 0, max: 10_000_000_000 }, rate: { t: 'number', min: 0, max: 100 },
                effectiveFrom: { t: 'day' }, effectiveTo: { t: 'day' }, campusId: { t: 'string', max: 128 }, responsibleUid: { t: 'string', max: 128 },
            });
        }
        catch (e) {
            (0, errors_1.invalid)({ [`components[${i}]`]: JSON.stringify(e?.details?.fieldErrors ?? {}) });
        }
        if (v.effectiveFrom && v.effectiveTo && v.effectiveFrom > v.effectiveTo)
            (0, errors_1.invalid)({ [`components[${i}].effectiveTo`]: 'Ngày hết hiệu lực phải sau ngày bắt đầu.' });
        if ((v.calc ?? 'fixed') === 'percent_of_base_pay' && v.rate === undefined)
            (0, errors_1.invalid)({ [`components[${i}].rate`]: 'Cần tỷ lệ %.' });
        if ((v.calc ?? 'fixed') !== 'percent_of_base_pay' && v.amount === undefined)
            (0, errors_1.invalid)({ [`components[${i}].amount`]: 'Cần số tiền.' });
        return v;
    });
    const ref = ctx.doc(`salaries/${empSnap.id}`);
    const cur = await ref.get();
    const payload = { employeeId: empSnap.id, campusId, ...d, components };
    let version = 1;
    if (cur.exists) {
        const { after } = await (0, store_1.updateDoc)(ctx, ref, payload, p?.expectedVersion);
        version = after.version;
    }
    else {
        await (0, store_1.createDoc)(ctx, 'salaries', empSnap.id, payload);
    }
    // Lịch sử thay đổi (ai, khi nào, giá trị trước/sau) — mỗi thành phần có ngày hiệu lực và người chịu trách nhiệm.
    await ctx.col(`salaries/${empSnap.id}/history`).add({ at: firebase_1.Timestamp.now(), by: ctx.uid, before: cur.data() ?? null, after: payload });
    await ctx.audit({ action: 'salary.save', collection: 'salaries', docId: empSnap.id, campusId, before: cur.data() ? { baseSalary: cur.data()?.baseSalary } : null, after: { baseSalary: d.baseSalary, components: components.length } });
    return { employeeId: empSnap.id, version };
};
const runIdOf = (campusId, periodKey) => `pr_${campusId}_${periodKey}`;
const payrollBuild = async (ctx, p) => {
    const { id: campusId, campus } = await (0, common_1.resolveCampus)(ctx, p, 'payroll.write');
    const periodKey = (0, common_1.needPeriod)(p?.periodKey);
    const runId = runIdOf(campusId, periodKey);
    const run = await ctx.doc(`payrollRuns/${runId}`).get();
    if (run.exists && run.data()?.status !== 'draft')
        (0, errors_1.fail)('INVALID_STATE', `Bảng lương kỳ ${periodKey} đã ở trạng thái "${run.data()?.status}"; không lập lại.`);
    const ts = await ctx.doc(`timesheets/${campusId}_${periodKey}`).get();
    if (!ts.exists || ts.data()?.status !== 'locked')
        (0, errors_1.fail)('PRECONDITION', 'Chỉ lập bảng lương từ bảng công ĐÃ KHÓA. Khóa kỳ công trước.', { reason: 'TIMESHEET_NOT_LOCKED' });
    const t = ts.data();
    const { from, to } = (0, time_1.periodRange)(periodKey);
    const stdBase = p?.standardDays ?? campus.standardWorkDays ?? 26;
    if (!(stdBase > 0 && stdBase <= 31))
        (0, errors_1.invalid)({ standardDays: 'Công chuẩn phải trong khoảng 1–31.' });
    const items = [];
    const errors = [];
    for (const e of t.employees ?? []) {
        const emp = await ctx.doc(`employees/${e.employeeId}`).get();
        const ed = emp.data() ?? {};
        const sal = await ctx.doc(`salaries/${e.employeeId}`).get();
        if (!sal.exists) {
            errors.push({ employeeId: e.employeeId, name: e.name, message: 'Chưa có thành phần lương (salary.save).' });
            continue;
        }
        const contracts = (0, common_1.asDocs)(await ctx.col('contracts').where('employeeId', '==', e.employeeId).get()).filter((c) => c.status !== 'cancelled' && c.startDate <= to && (!c.endDate || c.endDate >= from));
        if (!contracts.length) {
            errors.push({ employeeId: e.employeeId, name: e.name, message: 'Không có hợp đồng hiệu lực trong kỳ.' });
            continue;
        }
        const s = sal.data();
        const std = contracts.find((c) => c.standardDays)?.standardDays ?? stdBase;
        const comps = (s.components ?? []).filter((c) => (0, hr_common_1.effectiveRange)(to, c.effectiveFrom, c.effectiveTo) || (0, hr_common_1.effectiveRange)(from, c.effectiveFrom, c.effectiveTo))
            .filter((c) => (c.campusId ? c.campusId === campusId : ed.campusId === campusId)); // phụ cấp cố định tính tại cơ sở chính; theo cơ sở nếu chỉ định
        const r = (0, calc_pay_1.computePayroll)({ base: s.baseSalary, standardDays: std, paidDays: e.paidDaysTotal, overtimeMinutes: e.totals.overtimeMinutes, overtimeRate: s.overtimeRate, components: comps });
        items.push({
            employeeId: e.employeeId, employeeUid: ed.uid ?? null, name: e.name, code: e.code ?? ed.code ?? null, campusId, periodKey,
            baseSalary: s.baseSalary, standardDays: std, paidDays: e.paidDaysTotal, overtimeMinutes: e.totals.overtimeMinutes, lateMinutes: e.totals.lateMinutes,
            basePay: r.basePay, overtimePay: r.overtimePay, lines: r.lines, allowances: r.allowances, deductions: r.deductions, gross: r.gross, net: r.net,
            paidAmount: 0, paymentStatus: 'unpaid', contractId: contracts[0].id,
        });
    }
    const totals = items.reduce((a, i) => ({ gross: a.gross + i.gross, deductions: a.deductions + i.deductions, net: a.net + i.net }), { gross: 0, deductions: 0, net: 0 });
    const now = firebase_1.Timestamp.now();
    const rref = ctx.doc(`payrollRuns/${runId}`);
    const old = (0, common_1.asDocs)(await ctx.col(`payrollRuns/${runId}/items`).get());
    const ops = [];
    ops.push((b) => b.set(rref, {
        campusId, periodKey, status: 'draft', paymentStatus: 'unpaid', timesheetId: ts.id, timesheetLockVersion: t.lockVersion ?? 1, standardDays: stdBase,
        headcount: items.length, totals: { ...totals, paid: 0 }, errors, builtAt: now, builtBy: ctx.uid,
        createdAt: run.data()?.createdAt ?? now, createdBy: run.data()?.createdBy ?? ctx.uid, updatedAt: now, updatedBy: ctx.uid, version: (run.data()?.version ?? 0) + 1,
    }));
    for (const it of items)
        ops.push((b) => b.set(ctx.doc(`payrollRuns/${runId}/items/${it.employeeId}`), { ...it, updatedAt: now, updatedBy: ctx.uid }));
    const keep = new Set(items.map((i) => i.employeeId));
    for (const o of old)
        if (!keep.has(o.id))
            ops.push((b) => b.delete(ctx.doc(`payrollRuns/${runId}/items/${o.id}`)));
    await (0, common_1.commitOps)(ops);
    await ctx.audit({ action: 'payroll.build', collection: 'payrollRuns', docId: runId, campusId, after: { headcount: items.length, net: totals.net, errors: errors.length } });
    return { runId, status: 'draft', headcount: items.length, totals, errors, items: items.map(({ lines, ...r }) => ({ ...r, lineCount: lines.length })) };
};
const payrollSubmit = async (ctx, p) => {
    const run = await (0, common_1.getInCampus)(ctx, 'payrollRuns', p?.runId, null, 'Bảng lương');
    ctx.require('payroll.write', run.campusId);
    if (run.status !== 'draft')
        (0, errors_1.fail)('INVALID_STATE', 'Chỉ gửi duyệt bảng lương ở trạng thái nháp.');
    if (run.errors?.length && p?.acknowledgeErrors !== true)
        (0, errors_1.fail)('PRECONDITION', `Bảng lương còn ${run.errors.length} nhân viên lỗi (thiếu lương/hợp đồng). Xử lý hoặc xác nhận bỏ qua.`, { reason: 'RUN_ERRORS', errors: run.errors });
    if (!run.headcount)
        (0, errors_1.fail)('PRECONDITION', 'Bảng lương không có nhân viên nào.');
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'payroll_run', campusId: run.campusId, refCollection: 'payrollRuns', refId: run.id,
        summary: `Bảng lương ${run.periodKey} — ${run.headcount} nhân viên, thực lĩnh ${run.totals.net}`, impact: { headcount: run.headcount, totals: run.totals, periodKey: run.periodKey },
    });
    await (0, store_1.updateDoc)(ctx, ctx.doc(`payrollRuns/${run.id}`), { status: 'submitted', submittedAt: firebase_1.Timestamp.now(), submittedBy: ctx.uid, approvalId });
    await ctx.audit({ action: 'payroll.submit', collection: 'payrollRuns', docId: run.id, campusId: run.campusId, after: run.totals });
    return { runId: run.id, status: 'submitted', approvalId };
};
async function decidePayroll(ctx, runId, decision, note, viaApproval) {
    const run = await (0, common_1.getInCampus)(ctx, 'payrollRuns', runId, null, 'Bảng lương');
    ctx.require('payroll.approve', run.campusId);
    if (run.status !== 'submitted')
        (0, errors_1.fail)('INVALID_STATE', 'Bảng lương chưa gửi duyệt hoặc đã được xử lý.');
    (0, common_1.separateDuties)(ctx, run.submittedBy, 'bảng lương');
    await (0, store_1.updateDoc)(ctx, ctx.doc(`payrollRuns/${runId}`), decision === 'approved'
        ? { status: 'approved', approvedAt: firebase_1.Timestamp.now(), approvedBy: ctx.uid, approvalNote: note ?? null }
        : { status: 'draft', rejectedAt: firebase_1.Timestamp.now(), rejectedBy: ctx.uid, rejectReason: note ?? null });
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'payrollRuns', runId, decision, note);
    await ctx.audit({ action: `payroll.${decision}`, collection: 'payrollRuns', docId: runId, campusId: run.campusId, reason: note, after: run.totals });
    return { runId, status: decision === 'approved' ? 'approved' : 'draft' };
}
(0, approvals_1.registerApprovalHandler)('payroll_run', {
    perm: 'payroll.approve',
    onApprove: (ctx, a, note) => decidePayroll(ctx, a.refId, 'approved', note, true),
    onReject: (ctx, a, note) => decidePayroll(ctx, a.refId, 'rejected', note, true),
});
const payrollApprove = async (ctx, p) => decidePayroll(ctx, p?.runId, p?.decision === 'rejected' ? 'rejected' : 'approved', p?.note, false);
const payrollPublish = async (ctx, p) => {
    const run = await (0, common_1.getInCampus)(ctx, 'payrollRuns', p?.runId, null, 'Bảng lương');
    ctx.require('payroll.write', run.campusId);
    if (run.status !== 'approved')
        (0, errors_1.fail)('INVALID_STATE', 'Chỉ phát hành phiếu lương sau khi bảng lương đã được duyệt.');
    const items = (0, common_1.asDocs)(await ctx.col(`payrollRuns/${run.id}/items`).get());
    const now = firebase_1.Timestamp.now();
    await (0, common_1.commitOps)(items.map((i) => (b) => b.set(ctx.doc(`payslips/${run.id}_${i.employeeId}`), {
        runId: run.id, employeeId: i.employeeId, employeeUid: i.employeeUid ?? null, campusId: run.campusId, periodKey: run.periodKey, name: i.name,
        baseSalary: i.baseSalary, standardDays: i.standardDays, paidDays: i.paidDays, overtimeMinutes: i.overtimeMinutes,
        basePay: i.basePay, overtimePay: i.overtimePay, lines: i.lines, allowances: i.allowances, deductions: i.deductions, gross: i.gross, net: i.net,
        paidAmount: i.paidAmount ?? 0, paymentStatus: i.paymentStatus ?? 'unpaid', status: 'published', publishedAt: now,
        createdAt: now, updatedAt: now, createdBy: ctx.uid, updatedBy: ctx.uid, version: 1,
    })));
    await (0, store_1.updateDoc)(ctx, ctx.doc(`payrollRuns/${run.id}`), { status: 'published', publishedAt: now, publishedBy: ctx.uid });
    for (const i of items.slice(0, 300))
        await (0, hr_common_2.notifyEmployee)(ctx, i.employeeId, run.campusId, 'Phiếu lương', `Phiếu lương kỳ ${run.periodKey} đã được phát hành.`, { c: 'payslips', id: `${run.id}_${i.employeeId}` });
    await ctx.audit({ action: 'payroll.publish', collection: 'payrollRuns', docId: run.id, campusId: run.campusId, after: { payslips: items.length } });
    return { runId: run.id, status: 'published', payslips: items.length };
};
const recordPayment = async (ctx, p) => {
    const run = await (0, common_1.getInCampus)(ctx, 'payrollRuns', p?.runId, null, 'Bảng lương');
    ctx.require('payroll.write', run.campusId);
    if (!['published', 'paid'].includes(run.status))
        (0, errors_1.fail)('INVALID_STATE', 'Chỉ ghi nhận chi trả sau khi đã phát hành phiếu lương.');
    const list = Array.isArray(p?.items) ? p.items : [];
    if (!list.length)
        (0, errors_1.invalid)({ items: 'Chưa có khoản chi nào.' });
    if (list.length > 300)
        (0, errors_1.fail)('LIMIT', 'Tối đa 300 khoản chi một lần.');
    const method = p?.method === 'cash' ? 'cash' : 'bank_transfer';
    const campus = await (0, store_1.getCampus)(ctx, run.campusId);
    const opId = ctx.opId;
    const result = await ctx.tx(async (t) => {
        const refs = list.map((it) => ctx.doc(`payrollRuns/${run.id}/items/${it?.employeeId}`));
        const runRef = ctx.doc(`payrollRuns/${run.id}`);
        const [runSnap, ...snaps] = await Promise.all([t.get(runRef), ...refs.map((r) => t.get(r))]);
        const seen = new Set();
        const out = [];
        let paidDelta = 0;
        list.forEach((it, idx) => {
            const amount = (0, common_1.needVnd)(it?.amount, `items[${idx}].amount`);
            if (seen.has(it.employeeId))
                (0, errors_1.invalid)({ [`items[${idx}]`]: 'Nhân viên bị lặp trong lần chi.' });
            seen.add(it.employeeId);
            const s = snaps[idx];
            if (!s.exists)
                (0, errors_1.invalid)({ [`items[${idx}].employeeId`]: 'Nhân viên không có trong bảng lương.' });
            const d = s.data();
            const remaining = d.net - (d.paidAmount ?? 0);
            if (amount > remaining)
                (0, errors_1.invalid)({ [`items[${idx}].amount`]: `Vượt số còn phải trả (${remaining}).` });
            const paid = (d.paidAmount ?? 0) + amount;
            const status = paid >= d.net ? 'paid' : 'partially_paid';
            t.update(refs[idx], { paidAmount: paid, paymentStatus: status, updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid });
            t.set(ctx.doc(`payslips/${run.id}_${it.employeeId}`), { paidAmount: paid, paymentStatus: status, updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid }, { merge: true });
            t.set(ctx.doc(`payrollRuns/${run.id}/payments/${opId}_${it.employeeId}`), {
                employeeId: it.employeeId, amount, method, reference: it.reference ?? p?.reference ?? null, paidAt: firebase_1.Timestamp.fromDate((0, common_1.toDate)(it.paidAt) ?? ctx.now), campusId: run.campusId, opId,
                ...ctx.metaCreate(),
            });
            t.set(ctx.doc(`cashLedger/payroll_${opId}_${it.employeeId}`), (0, ledger_1.ledgerData)(ctx, { campusId: run.campusId, dir: 'out', amount, channel: method, refType: 'payroll', refId: `${run.id}_${it.employeeId}`, tz: (0, common_1.tzOf)(campus) }));
            paidDelta += amount;
            out.push({ employeeId: it.employeeId, amount, paid, remaining: d.net - paid });
        });
        const rd = runSnap.data();
        const paidTotal = (rd.totals?.paid ?? 0) + paidDelta;
        const fully = paidTotal >= rd.totals.net;
        t.update(runRef, {
            'totals.paid': paidTotal, paymentStatus: fully ? 'paid' : 'partially_paid', ...(fully ? { status: 'paid', paidAt: firebase_1.Timestamp.now() } : {}),
            updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid, version: (rd.version ?? 0) + 1,
        });
        return { items: out, paidTotal, paymentStatus: fully ? 'paid' : 'partially_paid', status: fully ? 'paid' : rd.status };
    });
    await ctx.audit({ action: 'payroll.recordPayment', collection: 'payrollRuns', docId: run.id, campusId: run.campusId, after: { count: list.length, paidTotal: result.paidTotal } });
    return { runId: run.id, ...result };
};
exports.actions = {
    'salary.save': { scope: 'org', perm: 'payroll.write', handler: salarySave },
    'payroll.build': { scope: 'org', perm: 'payroll.write', handler: payrollBuild },
    'payroll.submit': { scope: 'org', perm: 'payroll.write', handler: payrollSubmit },
    'payroll.approve': { scope: 'org', perm: 'payroll.approve', handler: payrollApprove },
    'payroll.publish': { scope: 'org', perm: 'payroll.write', handler: payrollPublish },
    'payroll.recordPayment': { scope: 'org', perm: 'payroll.write', idempotent: true, handler: recordPayment },
};
