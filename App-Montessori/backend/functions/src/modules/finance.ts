// Học phí & thu tiền (W29–W36). Phần biểu phí + lập khoản phải thu ở file này; thanh toán/hoàn/chi ở finance-pay.ts.
// Tiền = số nguyên VND. Công thức & ví dụ chuẩn: docs/BUSINESS.txt mục 9–10.
import type { ActionMap, Ctx } from '../core/types';
import { Timestamp } from '../core/firebase';
import { fail, invalid } from '../core/errors';
import { createDoc, dayKeyOf, getCampus, updateDoc } from '../core/store';
import { registerEntity } from '../core/entity-registry';
import { registerApprovalHandler, createApproval, ApprovalDoc } from '../core/approvals';
import { validate } from '../core/validate';
import { asDocs, commitOps, Doc, getInCampus, needDay, needPeriod, resolveCampus, separateDuties, syncApproval, toDate, tzOf } from '../lib/common';
import { BillLine, computeBillLines, Extra, FeePolicyLike, summarizeLines } from '../lib/calc-fee';
import { addDays, listDays, periodRange, prevPeriodKey, weekday } from '../lib/time';
import { childName, OPEN_STATUSES } from '../lib/finance-common';
import { parentUidsOfChildren, sendSystemNotification } from '../lib/notify';
import { actions as payActions } from './finance-pay';

// ---------------------------------------------------------------- Entity: feePolicies (draft)
const itemRule = { t: 'array', max: 50 } as const;
registerEntity('feePolicies', {
  writePerm: 'fees.write', campusScoped: true, idPrefix: 'fp_', editableStatuses: ['draft'],
  schema: {
    name: { t: 'string', req: true, max: 150 }, code: { t: 'string', max: 30 }, academicYearId: { t: 'string', max: 128 },
    effectiveFrom: { t: 'day' }, items: itemRule, meal: { t: 'object' }, discounts: itemRule,
    classIds: { t: 'array', max: 100 }, seriesId: { t: 'string', max: 128 },
    proration: { t: 'string', oneOf: ['none', 'daily'] }, dueDay: { t: 'int', min: 1, max: 28 },
    includeTrial: { t: 'bool' }, note: { t: 'string', max: 1000 },
  },
  async beforeSave(_ctx, data, existing) {
    checkPolicyBody(data);
    return existing ? {} : { status: 'draft', versionNo: 1 };
  },
});

function checkPolicyBody(d: Record<string, any>): void {
  const errs: Record<string, string> = {};
  (d.items ?? []).forEach((it: any, i: number) => {
    if (!it || typeof it.code !== 'string' || !it.code) errs[`items[${i}].code`] = 'Bắt buộc.';
    if (!Number.isSafeInteger(it?.amount) || it.amount < 0) errs[`items[${i}].amount`] = 'Số tiền phải là số nguyên đồng không âm.';
    if (!['tuition', 'service', 'other'].includes(it?.type)) errs[`items[${i}].type`] = 'Loại khoản thu: tuition | service | other.';
  });
  (d.discounts ?? []).forEach((it: any, i: number) => {
    if (!it || typeof it.code !== 'string') errs[`discounts[${i}].code`] = 'Bắt buộc.';
    if (!Number.isSafeInteger(it?.amount) || it.amount < 0) errs[`discounts[${i}].amount`] = 'Số tiền phải là số nguyên đồng không âm.';
  });
  if (d.meal) {
    if (!Number.isSafeInteger(d.meal.unitPrice) || d.meal.unitPrice < 0) errs['meal.unitPrice'] = 'Đơn giá phải là số nguyên đồng không âm.';
    if (d.meal.mode && !['provisional', 'actual'].includes(d.meal.mode)) errs['meal.mode'] = 'Cách tính: provisional | actual.';
  }
  if (Object.keys(errs).length) invalid(errs);
}

const feePolicyPublish = async (ctx: Ctx, p: any) => {
  let doc = await getInCampus(ctx, 'feePolicies', p?.id, null, 'Biểu phí');
  ctx.require('fees.write', doc.campusId);
  const campusId = doc.campusId as string;
  const seriesId = (doc.seriesId as string | undefined) ?? doc.id;
  const siblings = asDocs(await ctx.col('feePolicies').where('campusId', '==', campusId).where('seriesId', '==', seriesId).get());
  if (!siblings.find((s) => s.id === doc.id)) siblings.push(doc);
  let createdFrom: string | null = null;
  if (doc.status !== 'draft') {
    // Sửa biểu phí đã phát hành = tạo PHIÊN BẢN MỚI (bản cũ giữ nguyên cho các khoản thu lịch sử).
    const eff = needDay(p?.effectiveFrom, 'effectiveFrom');
    const base = validate<any>({ ...doc, ...(p?.changes ?? {}) }, {
      name: { t: 'string', req: true, max: 150 }, code: { t: 'string', max: 30 }, academicYearId: { t: 'string', max: 128 },
      items: itemRule, meal: { t: 'object' }, discounts: itemRule, classIds: { t: 'array', max: 100 }, proration: { t: 'string', oneOf: ['none', 'daily'] },
      dueDay: { t: 'int', min: 1, max: 28 }, includeTrial: { t: 'bool' }, note: { t: 'string', max: 1000 },
    });
    checkPolicyBody(base);
    const maxV = Math.max(...siblings.map((s) => s.versionNo ?? 1));
    const id = await createDoc(ctx, 'feePolicies', undefined, { ...base, campusId, seriesId, status: 'draft', versionNo: maxV + 1, effectiveFrom: eff });
    createdFrom = doc.id;
    doc = await getInCampus(ctx, 'feePolicies', id, campusId, 'Biểu phí');
    siblings.push(doc);
  }
  const effectiveFrom = needDay(doc.effectiveFrom ?? p?.effectiveFrom, 'effectiveFrom');
  if (!(doc.items?.length || doc.meal)) invalid({ items: 'Biểu phí phải có ít nhất một khoản thu hoặc đơn giá tiền ăn.' });
  checkPolicyBody(doc);
  const live = siblings.filter((s) => s.id !== doc.id && s.status === 'published' && !s.effectiveTo);
  for (const l of live) if (l.effectiveFrom >= effectiveFrom) invalid({ effectiveFrom: `Ngày hiệu lực phải sau ngày hiệu lực của phiên bản đang áp dụng (${l.effectiveFrom}).` });
  const versionNo = doc.versionNo ?? Math.max(0, ...siblings.map((s) => s.versionNo ?? 0)) + 1;
  const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];
  const now = Timestamp.now();
  for (const l of live) ops.push((b) => b.update(ctx.doc(`feePolicies/${l.id}`), { effectiveTo: addDays(effectiveFrom, -1), status: 'superseded', supersededBy: doc.id, updatedAt: now, updatedBy: ctx.uid, version: (l.version ?? 0) + 1 }));
  ops.push((b) => b.update(ctx.doc(`feePolicies/${doc.id}`), { status: 'published', effectiveFrom, seriesId, versionNo, publishedAt: now, publishedBy: ctx.uid, updatedAt: now, updatedBy: ctx.uid, version: (doc.version ?? 0) + 1 }));
  await commitOps(ops);
  await ctx.audit({ action: 'feePolicy.publish', collection: 'feePolicies', docId: doc.id, campusId, after: { effectiveFrom, versionNo, supersedes: live.map((l) => l.id) } });
  return { id: doc.id, versionNo, effectiveFrom, seriesId, supersedes: live.map((l) => l.id), createdFrom };
};

// ---------------------------------------------------------------- Tính kỳ thu
interface PreviewRow {
  childId: string; name: string; classId?: string; policyId?: string; lines: BillLine[];
  billed: number; discount: number; net: number; openingDebt: number; openingBreakdown: Array<{ receivableId: string; periodKey: string; balance: number }>;
  totalDue: number; mealCount: number; refundMealCount: number; refundOrderIds: string[]; mealMode?: string; dueDate: string;
  existing?: { receivableId: string; status: string }; errors: string[];
}

function pickPolicy(policies: Doc[], child: Doc, periodStart: string): Doc | null {
  const eff = policies.filter((p) => p.effectiveFrom <= periodStart && (!p.effectiveTo || p.effectiveTo >= periodStart));
  const applicable = eff.filter((p) => !p.classIds?.length || (child.classId && p.classIds.includes(child.classId)));
  if (child.feePlanId) {
    const m = applicable.find((p) => p.id === child.feePlanId || p.seriesId === child.feePlanId);
    if (m) return m;
  }
  const specific = applicable.filter((p) => p.classIds?.length);
  const pool = specific.length ? specific : applicable;
  return pool.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

export async function computeBilling(ctx: Ctx, campusId: string, campus: Doc, periodKey: string, opts: { childIds?: string[]; extras?: Array<Extra & { childId: string }>; dueDate?: string }): Promise<{ rows: PreviewRow[]; errors: Array<{ childId?: string; message: string }> }> {
  const { from, to } = periodRange(periodKey);
  const prevKey = prevPeriodKey(periodKey);
  const prevRange = periodRange(prevKey);
  const policies = asDocs(await ctx.col('feePolicies').where('campusId', '==', campusId).where('status', 'in', ['published', 'superseded']).get());
  let children = asDocs(await ctx.col('children').where('campusId', '==', campusId).get()).filter((c) => !c.archived);
  const want = opts.childIds?.length ? new Set(opts.childIds) : null;
  if (want) {
    const unknown = [...want].filter((id) => !children.some((c) => c.id === id));
    if (unknown.length) invalid({ childIds: `Trẻ không thuộc cơ sở này: ${unknown.slice(0, 5).join(', ')}` });
    children = children.filter((c) => want.has(c.id));
  }
  const [exA, exB, ordersCur, ordersPrev, openRcv, existing, prevRcv] = await Promise.all([
    ctx.col('calendarExceptions').where('campusId', '==', campusId).get(),
    ctx.col('calendarExceptions').where('campusId', '==', null).get(),
    ctx.col('mealOrders').where('campusId', '==', campusId).where('dayKey', '>=', from).where('dayKey', '<=', to).get(),
    ctx.col('mealOrders').where('campusId', '==', campusId).where('dayKey', '>=', prevRange.from).where('dayKey', '<=', prevRange.to).get(),
    ctx.col('receivables').where('campusId', '==', campusId).where('status', 'in', [...OPEN_STATUSES]).get(),
    ctx.col('receivables').where('campusId', '==', campusId).where('periodKey', '==', periodKey).get(),
    ctx.col('receivables').where('campusId', '==', campusId).where('periodKey', '==', prevKey).get(),
  ]);
  const noSchool = new Set<string>();
  for (const x of [...asDocs(exA), ...asDocs(exB)]) {
    if (x.archived || (x.type && !['holiday', 'closed', 'no_school'].includes(x.type))) continue;
    const f = x.fromDay ?? x.dayKey; if (f) for (const d of listDays(f, x.toDay ?? f)) noSchool.add(d);
  }
  const weekdays: number[] = (campus.schoolWeekdays as number[] | undefined) ?? [1, 2, 3, 4, 5];
  const schoolDays = listDays(from, to).filter((d) => weekdays.includes(weekday(d)) && !noSchool.has(d));
  const orders = asDocs(ordersCur);
  const prevOrders = asDocs(ordersPrev);
  const open = asDocs(openRcv).filter((r) => r.periodKey < periodKey);
  const existingBy = new Map(asDocs(existing).map((r) => [r.childId + '|' + r.type, r]));
  const prevBy = new Map(asDocs(prevRcv).map((r) => [r.childId + '|' + r.type, r]));
  const extrasBy = new Map<string, Array<Extra>>();
  for (const e of opts.extras ?? []) (extrasBy.get(e.childId) ?? extrasBy.set(e.childId, []).get(e.childId)!).push(e);

  const rows: PreviewRow[] = []; const errors: Array<{ childId?: string; message: string }> = [];
  for (const child of children) {
    const errs: string[] = [];
    const eligible = child.status === 'active' || child.status === 'trial';
    if (!eligible) continue; // chỉ trẻ đang học (và học thử nếu biểu phí cho phép) có khoản phải thu
    const policy = pickPolicy(policies, child, from);
    if (child.status === 'trial' && !policy?.includeTrial) continue;
    const start = (child.startDate ?? child.enrolledOn ?? child.enrolledAt) as string | undefined;
    const end = (child.endDate ?? child.withdrawnOn) as string | undefined;
    if (start && start > to) continue;
    if (end && end < from) continue;
    if (!policy) { errs.push('Chưa có biểu phí hiệu lực cho trẻ này trong kỳ.'); }
    const mode = (policy?.meal?.mode as 'provisional' | 'actual' | undefined) ?? 'provisional';
    const myDays = schoolDays.filter((d) => (!start || d >= start) && (!end || d <= end));
    const mealOn = child.mealEnabled !== false;
    const mealCount = !policy?.meal || !mealOn ? 0
      : mode === 'actual' ? orders.filter((o) => o.childId === child.id && o.served === true && o.billable !== false).length
      : (typeof policy.meal.daysPerMonth === 'number' ? policy.meal.daysPerMonth : myDays.length);
    // Hoàn trừ tiền ăn kỳ trước: chỉ khi kỳ trước tạm thu và suất đã hủy đủ điều kiện (billable=false) chưa hoàn lần nào.
    const prevR = prevBy.get(`${child.id}|monthly`);
    const refundOrders = mode === 'provisional' && prevR && prevR.status !== 'cancelled' && prevR.mealMode === 'provisional'
      ? prevOrders.filter((o) => o.childId === child.id && o.billable === false && o.locked === true && (!o.refundPeriodKey || o.refundPeriodKey === periodKey)) : [];
    const dailyProrate = !!(start && start > from) || !!(end && end < to);
    const lines = policy ? computeBillLines(policy as FeePolicyLike, {
      classId: child.classId, mealCount, refundMealCount: refundOrders.length,
      extras: extrasBy.get(child.id), childDiscounts: Array.isArray(child.discounts) ? child.discounts : [],
      prorate: dailyProrate ? { days: myDays.length, of: schoolDays.length || 1 } : null,
    }) : [];
    const sum = summarizeLines(lines);
    if (policy && sum.net < 0) errs.push('Tổng phải thu của kỳ âm (giảm trừ/hoàn lớn hơn khoản thu).');
    if (policy && !lines.length) errs.push('Không có dòng thu nào trong kỳ.');
    const ob = open.filter((r) => r.childId === child.id);
    const openingDebt = ob.reduce((s, r) => s + (r.balance ?? 0), 0);
    const ex = existingBy.get(`${child.id}|monthly`);
    const dueDate = opts.dueDate ?? (policy?.dueDay ? `${periodKey}-${String(policy.dueDay).padStart(2, '0')}` : `${periodKey}-10`);
    rows.push({
      childId: child.id, name: childName(child), classId: child.classId, policyId: policy?.id, lines, billed: sum.billed, discount: sum.discount, net: sum.net,
      openingDebt, openingBreakdown: ob.map((r) => ({ receivableId: r.id, periodKey: r.periodKey, balance: r.balance })),
      totalDue: openingDebt + sum.net, // nợ cũ và phải thu mới TÁCH: nợ cũ nằm ở các khoản kỳ trước, không cộng vào khoản kỳ mới
      mealCount, refundMealCount: refundOrders.length, refundOrderIds: refundOrders.map((o) => o.id), mealMode: mode, dueDate,
      existing: ex ? { receivableId: ex.id, status: ex.status } : undefined, errors: errs,
    });
    for (const m of errs) errors.push({ childId: child.id, message: `${childName(child)}: ${m}` });
  }
  return { rows, errors };
}

function parseExtras(v: unknown): Array<Extra & { childId: string }> {
  if (!Array.isArray(v)) return [];
  return v.map((e: any, i: number) => {
    if (typeof e?.childId !== 'string' || typeof e?.description !== 'string' || !Number.isSafeInteger(e?.amount) || e.amount === 0) invalid({ [`extras[${i}]`]: 'Cần childId, description và amount (số nguyên đồng khác 0).' });
    return { childId: e.childId, code: e.code, type: e.type, description: e.description, amount: e.amount };
  });
}

const billingPreview = async (ctx: Ctx, p: any) => {
  const { id: campusId, campus } = await resolveCampus(ctx, p, 'billing.write');
  const periodKey = needPeriod(p?.periodKey);
  const r = await computeBilling(ctx, campusId, campus, periodKey, { childIds: p?.childIds, extras: parseExtras(p?.extras), dueDate: p?.dueDate });
  const ok = r.rows.filter((x) => !x.errors.length);
  return {
    campusId, periodKey, draft: true, rows: r.rows, errors: r.errors,
    totals: { children: r.rows.length, ok: ok.length, failed: r.rows.length - ok.length, newReceivable: ok.reduce((s, x) => s + x.net, 0), openingDebt: ok.reduce((s, x) => s + x.openingDebt, 0), totalDue: ok.reduce((s, x) => s + x.totalDue, 0) },
  };
};

const rcvId = (childId: string, periodKey: string, type = 'monthly') => `rcv_${childId}_${periodKey}_${type}`;

const billingRun = async (ctx: Ctx, p: any) => {
  const { id: campusId, campus } = await resolveCampus(ctx, p, 'billing.write');
  const periodKey = needPeriod(p?.periodKey);
  const runId = `br_${campusId}_${periodKey}`;
  const runRef = ctx.doc(`billingRuns/${runId}`);
  const runSnap = await runRef.get();
  if (runSnap.exists && !['draft', 'rejected'].includes(runSnap.data()?.status)) fail('INVALID_STATE', `Kỳ thu ${periodKey} đã ở trạng thái "${runSnap.data()?.status}"; chỉ sửa qua chứng từ điều chỉnh.`);
  const r = await computeBilling(ctx, campusId, campus, periodKey, { childIds: p?.childIds, extras: parseExtras(p?.extras), dueDate: p?.dueDate });
  const now = Timestamp.now();
  const results: Array<{ childId: string; name: string; result: string; receivableId?: string; message?: string; net?: number }> = [];
  const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];
  let totalNet = 0; let created = 0; let updated = 0;
  for (const row of r.rows) {
    const id = rcvId(row.childId, periodKey);
    if (row.errors.length) { results.push({ childId: row.childId, name: row.name, result: 'error', message: row.errors.join(' ') }); continue; }
    if (row.existing && row.existing.status !== 'draft') { results.push({ childId: row.childId, name: row.name, result: 'skipped_existing', receivableId: id, message: 'Khoản phải thu kỳ này đã phát hành; dùng receivable.adjust.' }); continue; }
    const prev = row.existing ? (await ctx.doc(`receivables/${id}`).get()).data() : undefined;
    const data = {
      childId: row.childId, childName: row.name, classId: row.classId ?? null, campusId, periodKey, type: 'monthly', billingRunId: runId,
      lines: row.lines, billed: row.billed, discount: row.discount, adjustUp: 0, openingDebt: 0, allocated: 0, balance: row.net, amount: row.net,
      dueDate: row.dueDate, status: 'draft', isOverdue: false, policyId: row.policyId ?? null, mealMode: row.mealMode ?? null, mealCount: row.mealCount, refundMealCount: row.refundMealCount,
    };
    ops.push((b) => b.set(ctx.doc(`receivables/${id}`), prev
      ? { ...data, updatedAt: now, updatedBy: ctx.uid, version: (prev.version ?? 0) + 1, createdAt: prev.createdAt, createdBy: prev.createdBy }
      : { ...data, ...ctx.metaCreate() }));
    for (const oid of row.refundOrderIds) ops.push((b) => b.update(ctx.doc(`mealOrders/${oid}`), { refundPeriodKey: periodKey, updatedAt: now }));
    if (prev) updated++; else created++;
    totalNet += row.net;
    results.push({ childId: row.childId, name: row.name, result: prev ? 'updated' : 'created', receivableId: id, net: row.net });
  }
  ops.push((b) => b.set(runRef, {
    campusId, periodKey, status: 'draft', counts: { created, updated, skipped: results.filter((x) => x.result === 'skipped_existing').length, errors: results.filter((x) => x.result === 'error').length },
    totalNew: totalNet, results: results.slice(0, 1000), runAt: now, runBy: ctx.uid,
    createdAt: runSnap.data()?.createdAt ?? now, createdBy: runSnap.data()?.createdBy ?? ctx.uid, updatedAt: now, updatedBy: ctx.uid, version: ((runSnap.data()?.version as number | undefined) ?? 0) + 1,
  }));
  await commitOps(ops);
  await ctx.audit({ action: 'billing.run', collection: 'billingRuns', docId: runId, campusId, after: { created, updated, totalNew: totalNet } });
  return { runId, status: 'draft', created, updated, totalNew: totalNet, results };
};

// ---------------------------------------------------------------- duyệt & phát hành
async function decideBillingRun(ctx: Ctx, runId: string, decision: 'approved' | 'rejected', note: string | undefined, viaApproval: boolean) {
  const run = await getInCampus(ctx, 'billingRuns', runId, null, 'Kỳ thu');
  ctx.require('billing.approve', run.campusId);
  if (run.status !== 'submitted') fail('INVALID_STATE', 'Kỳ thu chưa gửi duyệt hoặc đã được xử lý.');
  separateDuties(ctx, run.submittedBy ?? run.runBy, 'kỳ thu');
  await updateDoc(ctx, ctx.doc(`billingRuns/${runId}`), decision === 'approved'
    ? { status: 'approved', approvedBy: ctx.uid, approvedAt: Timestamp.now(), approvalNote: note ?? null }
    : { status: 'rejected', rejectedBy: ctx.uid, rejectedAt: Timestamp.now(), rejectReason: note ?? null });
  if (!viaApproval) await syncApproval(ctx, 'billingRuns', runId, decision, note);
  await ctx.audit({ action: `billing.${decision}`, collection: 'billingRuns', docId: runId, campusId: run.campusId, reason: note, after: { totalNew: run.totalNew } });
  return { runId, status: decision === 'approved' ? 'approved' : 'rejected' };
}

registerApprovalHandler('billing_run', {
  perm: 'billing.approve',
  onApprove: (ctx, a: ApprovalDoc, note) => decideBillingRun(ctx, a.refId!, 'approved', note, true),
  onReject: (ctx, a: ApprovalDoc, note) => decideBillingRun(ctx, a.refId!, 'rejected', note, true),
});

/** billing.approve: người có billing.approve duyệt thẳng; người chỉ có billing.write gửi yêu cầu duyệt (approval 'billing_run'). */
const billingApprove = async (ctx: Ctx, p: any) => {
  const run = await getInCampus(ctx, 'billingRuns', p?.runId, null, 'Kỳ thu');
  if (!ctx.can('billing.approve', run.campusId)) {
    ctx.require('billing.write', run.campusId);
    if (run.status === 'submitted') fail('INVALID_STATE', 'Kỳ thu đã gửi duyệt, đang chờ người có thẩm quyền.');
    if (!['draft', 'rejected'].includes(run.status)) fail('INVALID_STATE', 'Kỳ thu không ở trạng thái có thể gửi duyệt.');
    const res = run.results as any[] | undefined;
    if (res?.some((x) => x.result === 'error') && p?.acknowledgeErrors !== true) fail('PRECONDITION', 'Kỳ thu còn dòng lỗi; xử lý hoặc xác nhận bỏ qua (acknowledgeErrors).', { reason: 'RUN_ERRORS' });
    const approvalId = await createApproval(ctx, {
      type: 'billing_run', campusId: run.campusId, refCollection: 'billingRuns', refId: run.id,
      summary: `Duyệt kỳ thu ${run.periodKey} — tổng phải thu mới ${run.totalNew}`, impact: { periodKey: run.periodKey, counts: run.counts, totalNew: run.totalNew },
    });
    await updateDoc(ctx, ctx.doc(`billingRuns/${run.id}`), { status: 'submitted', submittedBy: ctx.uid, submittedAt: Timestamp.now(), approvalId });
    return { runId: run.id, status: 'submitted', approvalId };
  }
  if (run.status === 'draft' || run.status === 'rejected') {
    // người duyệt tự lập + tự duyệt: chỉ chủ sở hữu (separateDuties) — đi qua trạng thái submitted để lưu vết
    await updateDoc(ctx, ctx.doc(`billingRuns/${run.id}`), { status: 'submitted', submittedBy: run.runBy ?? ctx.uid, submittedAt: Timestamp.now() });
  }
  if (p?.decision === 'rejected') return decideBillingRun(ctx, run.id, 'rejected', p?.note, false);
  return decideBillingRun(ctx, run.id, 'approved', p?.note, false);
};

const billingPublish = async (ctx: Ctx, p: any) => {
  const run = await getInCampus(ctx, 'billingRuns', p?.runId, null, 'Kỳ thu');
  ctx.require('billing.write', run.campusId);
  if (run.status !== 'approved') fail('INVALID_STATE', 'Chỉ phát hành kỳ thu đã được duyệt.');
  const campus = await getCampus(ctx, run.campusId);
  const today = dayKeyOf(ctx.now, tzOf(campus));
  const rs = asDocs(await ctx.col('receivables').where('billingRunId', '==', run.id).get()).filter((r) => r.status === 'draft');
  const now = Timestamp.now();
  await commitOps(rs.map((r) => (b) => b.update(ctx.doc(`receivables/${r.id}`), {
    status: r.dueDate && r.dueDate < today && r.balance > 0 ? 'overdue' : 'unpaid', isOverdue: !!(r.dueDate && r.dueDate < today && r.balance > 0),
    issuedAt: now, issuedBy: ctx.uid, updatedAt: now, updatedBy: ctx.uid, version: (r.version ?? 0) + 1,
  })));
  await updateDoc(ctx, ctx.doc(`billingRuns/${run.id}`), { status: 'published', publishedAt: now, publishedBy: ctx.uid, issuedCount: rs.length });
  // Thông báo phụ huynh (nội dung chung, không nêu số tiền).
  let notified = 0;
  try {
    const parents = await parentUidsOfChildren(ctx, rs.map((r) => r.childId), { needViewFees: true });
    const uids = [...parents.keys()];
    if (uids.length) {
      await sendSystemNotification(ctx, { campusId: run.campusId, title: 'Học phí mới', body: `Khoản thu kỳ ${run.periodKey} đã được phát hành. Xem chi tiết trong mục Học phí.`, category: 'tuition', uids, refCollection: 'billingRuns', refId: run.id });
      notified = uids.length;
    }
  } catch (e) { console.warn('billing.publish notify', (e as Error).message); }
  await ctx.audit({ action: 'billing.publish', collection: 'billingRuns', docId: run.id, campusId: run.campusId, after: { issued: rs.length, notified } });
  return { runId: run.id, status: 'published', issued: rs.length, notifiedParents: notified };
};

export const actions: ActionMap = {
  'feePolicy.publish': { scope: 'org', perm: 'fees.write', handler: feePolicyPublish },
  'billing.preview': { scope: 'org', perm: 'billing.write', handler: billingPreview },
  'billing.run': { scope: 'org', perm: 'billing.write', handler: billingRun },
  'billing.approve': { scope: 'org', handler: billingApprove },
  'billing.publish': { scope: 'org', perm: 'billing.write', handler: billingPublish },
  ...payActions,
};

void toDate;
