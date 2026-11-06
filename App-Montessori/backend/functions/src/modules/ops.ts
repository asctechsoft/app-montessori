// Bếp / kho / tài sản / đưa đón (W37–W40). Xem docs/BUSINESS.txt mục 10–11.
import type { ActionMap, Ctx } from '../core/types';
import { Timestamp } from '../core/firebase';
import { fail, invalid } from '../core/errors';
import { createDoc, dayKeyOf, getCampus, updateDoc } from '../core/store';
import { registerEntity } from '../core/entity-registry';
import { registerApprovalHandler, createApproval, ApprovalDoc } from '../core/approvals';
import { validate } from '../core/validate';
import { asDocs, commitOps, Doc, getInCampus, needDay, needDecision, needStr, resolveCampus, separateDuties, syncApproval, toDate, tzOf } from '../lib/common';
import { allergyConflicts, fefoPlan, mealCancelledFor, stockValue } from '../lib/calc-ops';
import { addDays, dayIndex, listDays } from '../lib/time';
import { childName, patchOf } from '../lib/finance-common';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

// ---------------------------------------------------------------- Entity registry
registerEntity('stockItems', {
  writePerm: 'stock.write', campusScoped: true, uniqueBy: ['code'], idPrefix: 'si_',
  schema: {
    code: { t: 'string', req: true, max: 30 }, name: { t: 'string', req: true, max: 150 }, group: { t: 'string', max: 60 },
    unit: { t: 'string', req: true, max: 20 }, minQty: { t: 'number', min: 0 }, conversions: { t: 'array', max: 10 },
    active: { t: 'bool' }, note: { t: 'string', max: 500 },
  },
  async beforeSave(_c, d, existing) {
    for (const [i, cv] of ((d.conversions as any[]) ?? []).entries()) {
      if (typeof cv?.unit !== 'string' || !(cv?.factor > 0)) invalid({ [`conversions[${i}]`]: 'Quy đổi cần unit và factor > 0 (số đơn vị cơ bản trên 1 đơn vị này).' });
    }
    return existing ? {} : { onHand: 0 };
  },
});

registerEntity('assets', {
  writePerm: 'assets.write', campusScoped: true, uniqueBy: ['code'], idPrefix: 'as_',
  schema: {
    code: { t: 'string', req: true, max: 30 }, name: { t: 'string', req: true, max: 150 }, category: { t: 'string', max: 60 },
    room: { t: 'string', max: 60 }, purchaseDate: { t: 'day' }, value: { t: 'int', min: 0 }, note: { t: 'string', max: 500 },
  },
  async beforeSave(_c, _d, existing) { return existing ? {} : { status: 'created', responsibleUid: null, history: 0 }; },
});

registerEntity('assetRequests', {
  writePerm: 'assets.write', campusScoped: true, idPrefix: 'ar_',
  schema: {
    assetId: { t: 'string', max: 128 }, title: { t: 'string', req: true, max: 200 }, description: { t: 'string', max: 1000 },
    priority: { t: 'string', oneOf: ['low', 'normal', 'high', 'urgent'] }, dueDate: { t: 'day' },
  },
  async beforeSave(ctx, d, existing) {
    if (d.assetId) { const a = await ctx.doc(`assets/${d.assetId}`).get(); if (!a.exists) invalid({ assetId: 'Tài sản không tồn tại.' }); }
    return existing ? {} : { status: 'open' };
  },
});

registerEntity('routes', {
  writePerm: 'transport.write', campusScoped: true, uniqueBy: ['code'], idPrefix: 'rt_',
  schema: {
    code: { t: 'string', req: true, max: 30 }, name: { t: 'string', req: true, max: 150 }, vehicle: { t: 'string', max: 30 },
    driverName: { t: 'string', max: 100 }, monitorName: { t: 'string', max: 100 }, driverUid: { t: 'string', max: 128 }, monitorUid: { t: 'string', max: 128 },
    stops: { t: 'array', max: 60 }, childIds: { t: 'array', max: 200 }, active: { t: 'bool' },
  },
  async beforeSave(ctx, d, existing) {
    const campusId = (d.campusId ?? existing?.campusId) as string | undefined;
    if (Array.isArray(d.childIds) && campusId) {
      const bad: string[] = [];
      for (const id of d.childIds as string[]) {
        if (typeof id !== 'string' || !SAFE_ID.test(id)) { bad.push(String(id)); continue; }
        const c = await ctx.doc(`children/${id}`).get();
        if (!c.exists || c.data()?.campusId !== campusId) bad.push(id);
      }
      if (bad.length) invalid({ childIds: `Trẻ không thuộc cơ sở: ${bad.slice(0, 5).join(', ')}` });
    }
  },
});

registerEntity('trips', {
  writePerm: 'transport.write', campusScoped: true, idPrefix: 'tr_',
  schema: {
    routeId: { t: 'string', req: true, max: 128 }, dayKey: { t: 'day', req: true }, direction: { t: 'string', req: true, oneOf: ['to_school', 'to_home'] },
    vehicle: { t: 'string', max: 30 }, note: { t: 'string', max: 500 },
  },
  async beforeSave(ctx, d, existing) {
    const campusId = (d.campusId ?? existing?.campusId) as string;
    if (d.routeId) { const r = await ctx.doc(`routes/${d.routeId}`).get(); if (!r.exists || r.data()?.campusId !== campusId) invalid({ routeId: 'Tuyến không thuộc cơ sở này.' }); }
    return existing ? {} : { status: 'planned', onboardCount: 0 };
  },
});

registerEntity('menus', {
  writePerm: 'kitchen.write', campusScoped: true, idPrefix: 'mn_', editableStatuses: ['draft', 'rejected'],
  schema: {
    dayKey: { t: 'day', req: true }, title: { t: 'string', max: 150 }, ageGroup: { t: 'string', max: 60 }, classIds: { t: 'array', max: 100 },
    meals: { t: 'array', req: true, max: 10 }, note: { t: 'string', max: 500 },
  },
  async beforeSave(_c, d, existing) {
    for (const [i, m] of ((d.meals as any[]) ?? []).entries()) {
      if (typeof m?.session !== 'string' || !Array.isArray(m?.dishes)) invalid({ [`meals[${i}]`]: 'Mỗi bữa cần session và dishes[{name, allergens?}].' });
      for (const [j, dish] of m.dishes.entries()) if (typeof dish?.name !== 'string' || !dish.name.trim()) invalid({ [`meals[${i}].dishes[${j}].name`]: 'Bắt buộc.' });
    }
    return existing ? { status: existing.status === 'rejected' ? 'draft' : existing.status } : { status: 'draft', substitutions: [], allergyWarnings: [] };
  },
});

// ---------------------------------------------------------------- thực đơn
interface Conflict { childId: string; childName: string; classId?: string; session: string; dish: string; allergen: string }

async function menuConflicts(ctx: Ctx, menu: Doc): Promise<Conflict[]> {
  const kids = asDocs(await ctx.col('children').where('campusId', '==', menu.campusId).get())
    .filter((c) => ['active', 'trial'].includes(c.status) && !c.archived && (!menu.classIds?.length || menu.classIds.includes(c.classId)));
  const out: Conflict[] = [];
  for (const k of kids) {
    // Chỉ lấy thông tin DỊ ỨNG/ chế độ ăn (không trả toàn bộ hồ sơ sức khỏe cho bếp).
    const h = await ctx.doc(`children/${k.id}/private/health`).get();
    const list: string[] = [...((h.data()?.allergies as string[]) ?? []), ...((h.data()?.dietaryRestrictions as string[]) ?? [])].filter((x) => typeof x === 'string');
    if (!list.length) continue;
    for (const m of (menu.meals as any[]) ?? []) for (const dish of m.dishes ?? []) {
      for (const a of allergyConflicts(dish.allergens ?? [], dish.name, list)) out.push({ childId: k.id, childName: childName(k), classId: k.classId, session: m.session, dish: dish.name, allergen: a });
    }
  }
  return out;
}

function unresolved(conflicts: Conflict[], subs: any[]): Conflict[] {
  return conflicts.filter((c) => !subs.some((s) => s.childId === c.childId && s.dish === c.dish && typeof s.replacement === 'string' && s.replacement.trim()));
}

const menuSubmit = async (ctx: Ctx, p: any) => {
  const menu = await getInCampus(ctx, 'menus', p?.id, null, 'Thực đơn');
  ctx.require('kitchen.write', menu.campusId);
  if (!['draft', 'rejected'].includes(menu.status)) fail('INVALID_STATE', 'Thực đơn không ở trạng thái nháp.');
  const subs: any[] = Array.isArray(p?.substitutions) ? p.substitutions : (menu.substitutions ?? []);
  const conflicts = await menuConflicts(ctx, menu);
  const open = unresolved(conflicts, subs);
  if (open.length) fail('PRECONDITION', `Có ${open.length} trẻ không dùng được món trong thực đơn. Chọn món thay thế (substitutions) cho từng trẻ.`, { reason: 'ALLERGY_SUBSTITUTION_REQUIRED', conflicts: open });
  const approvalId = await createApproval(ctx, {
    type: 'menu', campusId: menu.campusId, refCollection: 'menus', refId: menu.id,
    summary: `Duyệt thực đơn ngày ${menu.dayKey}`, impact: { dayKey: menu.dayKey, allergyChildren: [...new Set(conflicts.map((c) => c.childId))].length, substitutions: subs.length },
  });
  await updateDoc(ctx, ctx.doc(`menus/${menu.id}`), { status: 'submitted', substitutions: subs, allergyWarnings: conflicts, submittedBy: ctx.uid, submittedAt: Timestamp.now(), approvalId });
  await ctx.audit({ action: 'menu.submit', collection: 'menus', docId: menu.id, campusId: menu.campusId, after: { conflicts: conflicts.length } });
  return { id: menu.id, status: 'submitted', approvalId, warnings: conflicts };
};

async function decideMenu(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined, viaApproval: boolean) {
  const menu = await getInCampus(ctx, 'menus', id, null, 'Thực đơn');
  ctx.require('campus.manage', menu.campusId);
  if (menu.status !== 'submitted') fail('INVALID_STATE', 'Thực đơn chưa gửi duyệt hoặc đã được xử lý.');
  separateDuties(ctx, menu.submittedBy, 'thực đơn');
  await updateDoc(ctx, ctx.doc(`menus/${id}`), { status: decision === 'approved' ? 'approved' : 'rejected', decidedBy: ctx.uid, decidedAt: Timestamp.now(), decisionNote: note ?? null });
  if (!viaApproval) await syncApproval(ctx, 'menus', id, decision, note);
  await ctx.audit({ action: `menu.${decision}`, collection: 'menus', docId: id, campusId: menu.campusId, reason: note });
  return { id, status: decision === 'approved' ? 'approved' : 'rejected' };
}

registerApprovalHandler('menu', {
  perm: 'campus.manage',
  onApprove: (ctx, a: ApprovalDoc, note) => decideMenu(ctx, a.refId!, 'approved', note, true),
  onReject: (ctx, a: ApprovalDoc, note) => decideMenu(ctx, a.refId!, 'rejected', note, true),
});

const menuPublish = async (ctx: Ctx, p: any) => {
  const menu = await getInCampus(ctx, 'menus', p?.id, null, 'Thực đơn');
  ctx.require('kitchen.write', menu.campusId);
  if (menu.status !== 'approved') fail('INVALID_STATE', 'Chỉ công bố thực đơn đã được duyệt.');
  const conflicts = await menuConflicts(ctx, menu); // có thể phát sinh trẻ mới dị ứng sau khi duyệt
  const open = unresolved(conflicts, menu.substitutions ?? []);
  if (open.length) fail('PRECONDITION', 'Có trẻ mới không dùng được món; bổ sung món thay thế rồi gửi duyệt lại.', { reason: 'ALLERGY_SUBSTITUTION_REQUIRED', conflicts: open });
  await updateDoc(ctx, ctx.doc(`menus/${menu.id}`), { status: 'published', publishedAt: Timestamp.now(), publishedBy: ctx.uid });
  await ctx.audit({ action: 'menu.publish', collection: 'menus', docId: menu.id, campusId: menu.campusId });
  return { id: menu.id, status: 'published' };
};

// ---------------------------------------------------------------- chốt suất ăn
const mealLock = async (ctx: Ctx, p: any) => {
  const { id: campusId, campus } = await resolveCampus(ctx, p, 'kitchen.write');
  const dayKey = needDay(p?.dayKey, 'dayKey');
  const tz = tzOf(campus);
  if (dayIndex(dayKey) - dayIndex(dayKeyOf(ctx.now, tz)) > 7) invalid({ dayKey: 'Chỉ chốt suất tối đa 7 ngày tới.' });
  const lockRef = ctx.doc(`mealLocks/${campusId}_${dayKey}`);
  const existing = await lockRef.get();
  if (existing.exists) return { ...existing.data(), alreadyLocked: true }; // KHÔNG chốt lại/ghi đè dấu vết; sửa dùng meal.recordServed (điều chỉnh có lý do)
  const exceptions = [...asDocs(await ctx.col('calendarExceptions').where('campusId', '==', campusId).get()), ...asDocs(await ctx.col('calendarExceptions').where('campusId', '==', null).get())];
  for (const x of exceptions) {
    if (x.archived || (x.type && !['holiday', 'closed', 'no_school'].includes(x.type))) continue;
    const f = x.fromDay ?? x.dayKey; if (f && listDays(f, x.toDay ?? f).includes(dayKey)) fail('PRECONDITION', `Ngày ${dayKey} là ngày không học; không có suất ăn.`, { reason: 'NO_SCHOOL' });
  }
  const cutoff = (campus.mealCutoff as string | undefined) ?? '08:00';
  const kids = asDocs(await ctx.col('children').where('campusId', '==', campusId).get()).filter((c) => ['active', 'trial'].includes(c.status) && !c.archived && c.mealEnabled !== false
    && (!(c.startDate ?? c.enrolledOn ?? c.enrolledAt) || (c.startDate ?? c.enrolledOn ?? c.enrolledAt) <= dayKey) && (!(c.endDate ?? c.withdrawnOn) || (c.endDate ?? c.withdrawnOn) >= dayKey));
  const leaves = asDocs(await ctx.col('leaveRequests').where('campusId', '==', campusId).where('status', '==', 'approved').get()).filter((l) => l.fromDay <= dayKey && l.toDay >= dayKey && (!l.session || l.session === 'all'));
  const leaveBy = new Map<string, Doc>(); for (const l of leaves) leaveBy.set(l.childId, l);
  const now = Timestamp.now();
  const byClass: Record<string, { expected: number; locked: number }> = {};
  const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];
  let cancelled = 0; let lockedN = 0;
  for (const k of kids) {
    const lv = leaveBy.get(k.id);
    // Nghỉ được duyệt (và gửi) trước giờ chốt → hủy suất; sau giờ chốt vẫn tính vì bếp đã chuẩn bị.
    const cancel = !!lv && (Array.isArray(lv.mealCancelledDays) ? lv.mealCancelledDays.includes(dayKey) : lv.submittedAt || lv.decidedAt
      ? mealCancelledFor(dayKey, cutoff, toDate(lv.submittedAt ?? lv.createdAt), toDate(lv.decidedAt), tz)
      : lv.mealCancelled === true);
    const cls = (k.classId as string) ?? '_';
    byClass[cls] ??= { expected: 0, locked: 0 };
    byClass[cls].expected++;
    if (cancel) cancelled++; else { lockedN++; byClass[cls].locked++; }
    const oref = ctx.doc(`mealOrders/${k.id}_${dayKey}`);
    const prev = (await oref.get()).data();
    ops.push((b) => b.set(oref, {
      childId: k.id, childName: childName(k), classId: k.classId ?? null, campusId, dayKey,
      expected: true,           // suất dự kiến
      locked: !cancel,          // suất đã chốt cho bếp
      served: prev?.served ?? null, // suất sử dụng thực tế (ghi sau)
      billable: !cancel,        // suất đủ điều kiện tính tiền — KẾT QUẢ tính phí cuối cùng (một giá trị)
      cancelled: cancel, cancelReason: cancel ? { leaveId: lv!.id } : null, afterCutoffLeaveId: lv && !cancel ? lv.id : null,
      cutoff, lockedAt: now, lockedBy: ctx.uid, adjustments: prev?.adjustments ?? [],
      createdAt: prev?.createdAt ?? now, createdBy: prev?.createdBy ?? ctx.uid, updatedAt: now, updatedBy: ctx.uid, version: (prev?.version ?? 0) + 1,
    }));
  }
  const summary = { campusId, dayKey, cutoff, expected: kids.length, locked: lockedN, cancelled, byClass, lockedAt: now, lockedBy: ctx.uid, status: 'locked' };
  ops.push((b) => b.set(lockRef, { ...summary, ...ctx.metaCreate() }));
  await commitOps(ops);
  await ctx.audit({ action: 'meal.lock', collection: 'mealLocks', docId: `${campusId}_${dayKey}`, campusId, after: { expected: kids.length, locked: lockedN, cancelled } });
  return { ...summary, lockedAt: now.toDate().toISOString() };
};

const mealRecordServed = async (ctx: Ctx, p: any) => {
  const { id: campusId } = await resolveCampus(ctx, p, 'kitchen.write');
  const dayKey = needDay(p?.dayKey, 'dayKey');
  const items: any[] = Array.isArray(p?.items) ? p.items : [];
  if (!items.length) invalid({ items: 'Chưa có dòng nào.' });
  if (items.length > 600) fail('LIMIT', 'Tối đa 600 dòng một lần.');
  const lock = await ctx.doc(`mealLocks/${campusId}_${dayKey}`).get();
  if (!lock.exists) fail('PRECONDITION', 'Chưa chốt suất ngày này (meal.lock).', { reason: 'NOT_LOCKED' });
  const results: Array<{ childId: string; served: boolean | null; billable: boolean; adjusted: boolean }> = [];
  for (const [i, it] of items.entries()) {
    if (typeof it?.childId !== 'string') invalid({ [`items[${i}].childId`]: 'Bắt buộc.' });
    const ref = ctx.doc(`mealOrders/${it.childId}_${dayKey}`);
    const s = await ref.get();
    if (!s.exists || s.data()?.campusId !== campusId) invalid({ [`items[${i}].childId`]: 'Trẻ không có suất ăn ngày này ở cơ sở.' });
    const o = s.data()!;
    const patch: Record<string, unknown> = {};
    if (typeof it.served === 'boolean') { patch.served = it.served; patch.servedAt = Timestamp.now(); patch.servedBy = ctx.uid; }
    let adjusted = false;
    if (typeof it.billable === 'boolean' && it.billable !== o.billable) {
      const reason = typeof it.reason === 'string' ? it.reason.trim() : '';
      if (reason.length < 5) invalid({ [`items[${i}].reason`]: 'Sửa kết quả tính phí sau chốt phải có lý do (tối thiểu 5 ký tự).' });
      if (it.billable === true && o.refundPeriodKey) fail('PRECONDITION', 'Suất này đã được hoàn trừ ở kỳ thu sau; không thể chuyển lại thành tính phí.', { reason: 'ALREADY_REFUNDED' });
      // Không xóa dấu vết: ghi điều chỉnh (từ → sang, lý do, người, thời điểm). Một suất chỉ có MỘT kết quả cuối cùng.
      patch.billable = it.billable;
      patch.adjustments = [...(o.adjustments ?? []), { at: Timestamp.now(), by: ctx.uid, from: o.billable, to: it.billable, reason }];
      adjusted = true;
    }
    if (Object.keys(patch).length) await ref.update(patchOf(ctx, o.version, patch));
    results.push({ childId: it.childId, served: (patch.served as boolean | undefined) ?? o.served ?? null, billable: (patch.billable as boolean | undefined) ?? o.billable, adjusted });
  }
  const served = results.filter((r) => r.served === true).length;
  await ctx.audit({ action: 'meal.recordServed', collection: 'mealOrders', docId: `${campusId}_${dayKey}`, campusId, after: { items: items.length, adjusted: results.filter((r) => r.adjusted).length } });
  return { dayKey, updated: results.length, served, adjustments: results.filter((r) => r.adjusted).length, results };
};

// ---------------------------------------------------------------- kho
const q3 = (n: number) => Math.round(n * 1000) / 1000;

function toBase(item: Doc, qty: unknown, unit: unknown): { qty: number; factor: number } {
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || qty > 1e7) invalid({ qty: 'Số lượng phải là số dương.' });
  let factor = 1;
  if (typeof unit === 'string' && unit && unit !== item.unit) {
    const cv = (item.conversions as any[] | undefined)?.find((c) => c.unit === unit);
    if (!cv) invalid({ unit: `Đơn vị "${unit}" chưa được quy đổi cho mặt hàng này (đơn vị cơ bản: ${item.unit}).` });
    factor = cv.factor;
  }
  return { qty: q3(qty * factor), factor };
}

const stockReceive = async (ctx: Ctx, p: any) => {
  const item = await getInCampus(ctx, 'stockItems', p?.itemId, null, 'Mặt hàng');
  ctx.require('stock.write', item.campusId);
  const campus = await getCampus(ctx, item.campusId);
  const today = dayKeyOf(ctx.now, tzOf(campus));
  const lot = needStr(p?.lot, 'lot', 60);
  const { qty, factor } = toBase(item, p?.qty, p?.unit);
  if (!Number.isSafeInteger(p?.unitCost) || p.unitCost < 0) invalid({ unitCost: 'Đơn giá phải là số nguyên đồng không âm.' });
  const expiry = p?.expiry ? needDay(p.expiry, 'expiry') : null;
  if (expiry && expiry < today) invalid({ expiry: 'Hàng đã hết hạn; không nhập kho.' });
  const unitCost = Math.round(p.unitCost / factor); // đơn giá theo đơn vị cơ bản (điểm làm tròn khi quy đổi đơn vị)
  const lotId = `lot_${ctx.opId}`;
  await ctx.tx(async (t) => {
    const iref = ctx.doc(`stockItems/${item.id}`);
    const is = await t.get(iref);
    const now = Timestamp.now();
    t.update(iref, patchOf(ctx, is.data()?.version, { onHand: q3((is.data()?.onHand ?? 0) + qty), lastReceivedAt: now }));
    t.set(ctx.doc(`stockLots/${lotId}`), { itemId: item.id, campusId: item.campusId, lot, expiry, qtyReceived: qty, qtyRemaining: qty, unitCost, supplier: p?.supplier ?? null, status: 'active', receivedAt: now, ...ctx.metaCreate() });
    t.set(ctx.doc(`stockMovements/mv_${ctx.opId}`), { itemId: item.id, campusId: item.campusId, lotId, type: 'receive', qty, unitCost, value: stockValue(qty, unitCost), supplier: p?.supplier ?? null, at: now, ...ctx.metaCreate() });
  });
  await ctx.audit({ action: 'stock.receive', collection: 'stockLots', docId: lotId, campusId: item.campusId, after: { itemId: item.id, lot, qty, expiry } });
  return { lotId, itemId: item.id, qty, unit: item.unit };
};

interface IssueResult { picks: Array<{ lotId: string; lot: string; qty: number; unitCost: number }>; shortage: number; value: number }

async function issueTx(ctx: Ctx, t: FirebaseFirestore.Transaction, item: Doc, itemVersion: number, lotsSnap: FirebaseFirestore.QuerySnapshot, qty: number, today: string, type: string, mvPrefix: string, extra: Record<string, unknown>): Promise<IssueResult> {
  const lots = lotsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((l) => l.campusId === item.campusId);
  const plan = fefoPlan(lots.map((l) => ({ id: l.id, qtyRemaining: l.qtyRemaining, expiry: l.expiry, receivedAtMs: l.receivedAt?.toMillis?.() ?? 0, status: l.status })), qty, type === 'waste' ? '0000-00-00' : today);
  const now = Timestamp.now();
  const picks: IssueResult['picks'] = []; let value = 0;
  plan.picks.forEach((pk, i) => {
    const l = lots.find((x) => x.id === pk.lotId)!;
    const rem = q3(l.qtyRemaining - pk.qty);
    t.update(ctx.doc(`stockLots/${l.id}`), patchOf(ctx, l.version, { qtyRemaining: rem, ...(rem <= 0 ? { status: 'closed' } : {}) }));
    t.set(ctx.doc(`stockMovements/${mvPrefix}_${i}`), { itemId: item.id, campusId: item.campusId, lotId: l.id, lot: l.lot, type, qty: -pk.qty, unitCost: l.unitCost, value: stockValue(pk.qty, l.unitCost), at: now, ...extra, ...ctx.metaCreate() });
    picks.push({ lotId: l.id, lot: l.lot, qty: pk.qty, unitCost: l.unitCost });
    value += stockValue(pk.qty, l.unitCost);
  });
  if (plan.shortage > 0 && extra.allowNegative) {
    t.set(ctx.doc(`stockMovements/${mvPrefix}_neg`), { itemId: item.id, campusId: item.campusId, lotId: null, type, qty: -plan.shortage, unitCost: 0, value: 0, negativeStock: true, at: now, ...extra, ...ctx.metaCreate() });
  }
  const taken = q3(qty - plan.shortage + (extra.allowNegative ? plan.shortage : 0));
  t.update(ctx.doc(`stockItems/${item.id}`), patchOf(ctx, itemVersion, { onHand: q3((item.onHand ?? 0) - taken), lastIssuedAt: now }));
  return { picks, shortage: plan.shortage, value };
}

const stockIssue = async (ctx: Ctx, p: any) => {
  const item = await getInCampus(ctx, 'stockItems', p?.itemId, null, 'Mặt hàng');
  ctx.require('stock.write', item.campusId);
  const campus = await getCampus(ctx, item.campusId);
  const today = dayKeyOf(ctx.now, tzOf(campus));
  const { qty } = toBase(item, p?.qty, p?.unit);
  const purpose = typeof p?.purpose === 'string' ? p.purpose : 'kitchen';
  const type = purpose === 'waste' ? 'waste' : purpose === 'return' ? 'return_to_supplier' : 'issue';
  const allowNegative = p?.allowNegative === true;
  if (allowNegative) {
    ctx.require('campus.manage', item.campusId); // quyền ngoại lệ
    if (typeof p?.reason !== 'string' || p.reason.trim().length < 5) invalid({ reason: 'Xuất âm kho cần lý do (tối thiểu 5 ký tự).' });
  }
  const res = await ctx.tx(async (t) => {
    const [is, lots] = await Promise.all([t.get(ctx.doc(`stockItems/${item.id}`)), t.get(ctx.col('stockLots').where('itemId', '==', item.id).where('status', '==', 'active'))]);
    const cur = { id: is.id, ...(is.data() as any) } as Doc;
    const r = await issueTx(ctx, t, cur, is.data()?.version, lots, qty, today, type, `mv_${ctx.opId}`, { purpose, dayKey: p?.dayKey ?? today, reason: p?.reason ?? null, allowNegative });
    if (r.shortage > 0 && !allowNegative) fail('PRECONDITION', `Tồn kho không đủ (còn dùng được ${q3(qty - r.shortage)} ${item.unit}, cần ${qty}). Hàng hết hạn không được xuất.`, { reason: 'INSUFFICIENT_STOCK', available: q3(qty - r.shortage) });
    return r;
  });
  await ctx.audit({ action: allowNegative ? 'stock.issue.negative' : 'stock.issue', collection: 'stockItems', docId: item.id, campusId: item.campusId, reason: p?.reason, after: { qty, purpose, picks: res.picks.length, shortage: res.shortage } });
  return { itemId: item.id, qty, issued: res.picks, shortage: res.shortage, value: res.value, type };
};

// kiểm kê
const stockStocktake = async (ctx: Ctx, p: any) => {
  const { id: campusId } = await resolveCampus(ctx, p, 'stock.write');
  const counts: any[] = Array.isArray(p?.counts) ? p.counts : [];
  if (!counts.length) invalid({ counts: 'Chưa có dòng kiểm kê.' });
  if (counts.length > 200) fail('LIMIT', 'Tối đa 200 mặt hàng một phiếu kiểm kê.');
  const lines: any[] = [];
  for (const [i, c] of counts.entries()) {
    const item = await getInCampus(ctx, 'stockItems', c?.itemId, campusId, 'Mặt hàng');
    if (item.campusId !== campusId) invalid({ [`counts[${i}].itemId`]: 'Mặt hàng không thuộc cơ sở.' });
    if (typeof c.countedQty !== 'number' || c.countedQty < 0) invalid({ [`counts[${i}].countedQty`]: 'Số lượng kiểm đếm phải ≥ 0.' });
    const lots = asDocs(await ctx.col('stockLots').where('itemId', '==', item.id).where('status', '==', 'active').get()).filter((l) => l.qtyRemaining > 0);
    const avg = lots.length ? Math.round(lots.reduce((s, l) => s + l.unitCost * l.qtyRemaining, 0) / lots.reduce((s, l) => s + l.qtyRemaining, 0)) : 0;
    const system = item.onHand ?? 0; const variance = q3(c.countedQty - system);
    lines.push({ itemId: item.id, code: item.code, name: item.name, unit: item.unit, systemQty: system, countedQty: c.countedQty, variance, unitCost: avg, varianceValue: stockValue(variance, avg) });
  }
  const diff = lines.filter((l) => l.variance !== 0);
  const id = await createDoc(ctx, 'stocktakes', undefined, { campusId, lines, note: p?.note ?? null, status: diff.length ? 'pending_approval' : 'closed', varianceCount: diff.length, totalVarianceValue: diff.reduce((s, l) => s + l.varianceValue, 0) });
  let approvalId: string | null = null;
  if (diff.length) {
    approvalId = await createApproval(ctx, {
      type: 'stock_variance', campusId, refCollection: 'stocktakes', refId: id,
      summary: `Duyệt chênh lệch kiểm kê (${diff.length} mặt hàng)`, impact: { varianceCount: diff.length, totalVarianceValue: diff.reduce((s, l) => s + l.varianceValue, 0), lines: diff.slice(0, 20) },
    });
    await ctx.doc(`stocktakes/${id}`).update({ approvalId });
  }
  await ctx.audit({ action: 'stock.stocktake', collection: 'stocktakes', docId: id, campusId, after: { lines: lines.length, variances: diff.length } });
  return { id, status: diff.length ? 'pending_approval' : 'closed', approvalId, lines };
};

async function decideVariance(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined, viaApproval: boolean) {
  const st = await getInCampus(ctx, 'stocktakes', id, null, 'Phiếu kiểm kê');
  ctx.require('campus.manage', st.campusId);
  if (st.status !== 'pending_approval') fail('INVALID_STATE', 'Phiếu kiểm kê không chờ duyệt.');
  separateDuties(ctx, st.createdBy, 'phiếu kiểm kê');
  if (decision === 'rejected') {
    await updateDoc(ctx, ctx.doc(`stocktakes/${id}`), { status: 'rejected', decidedBy: ctx.uid, decidedAt: Timestamp.now(), decisionNote: note ?? null });
    if (!viaApproval) await syncApproval(ctx, 'stocktakes', id, 'rejected', note);
    return { id, status: 'rejected' };
  }
  const campus = await getCampus(ctx, st.campusId);
  const today = dayKeyOf(ctx.now, tzOf(campus));
  const diff = (st.lines as any[]).filter((l) => l.variance !== 0);
  await ctx.tx(async (t) => {
    const reads = await Promise.all(diff.map(async (l) => ({
      l, is: await t.get(ctx.doc(`stockItems/${l.itemId}`)),
      lots: l.variance < 0 ? await t.get(ctx.col('stockLots').where('itemId', '==', l.itemId).where('status', '==', 'active')) : null,
    })));
    const now = Timestamp.now();
    for (const { l, is, lots } of reads) {
      const item = { id: is.id, ...(is.data() as any) } as Doc;
      if (l.variance > 0) {
        t.set(ctx.doc(`stockLots/kk_${id}_${l.itemId}`), { itemId: l.itemId, campusId: st.campusId, lot: `KK-${id.slice(0, 6)}`, expiry: null, qtyReceived: l.variance, qtyRemaining: l.variance, unitCost: l.unitCost, supplier: null, status: 'active', receivedAt: now, source: 'stocktake', ...ctx.metaCreate() });
        t.set(ctx.doc(`stockMovements/kk_${id}_${l.itemId}`), { itemId: l.itemId, campusId: st.campusId, lotId: `kk_${id}_${l.itemId}`, type: 'stocktake_adjust', qty: l.variance, unitCost: l.unitCost, value: stockValue(l.variance, l.unitCost), stocktakeId: id, at: now, ...ctx.metaCreate() });
        t.update(ctx.doc(`stockItems/${l.itemId}`), patchOf(ctx, item.version, { onHand: q3((item.onHand ?? 0) + l.variance) }));
      } else {
        // thiếu hàng: trừ theo FEFO (cho phép trừ cả lô hết hạn vì là điều chỉnh kiểm kê)
        await issueTx(ctx, t, item, item.version ?? 0, lots!, -l.variance, '0000-00-00', 'stocktake_adjust', `kk_${id}_${l.itemId}`, { stocktakeId: id, allowNegative: true });
      }
    }
    t.update(ctx.doc(`stocktakes/${id}`), patchOf(ctx, st.version, { status: 'approved', decidedBy: ctx.uid, decidedAt: now, decisionNote: note ?? null }));
  });
  if (!viaApproval) await syncApproval(ctx, 'stocktakes', id, 'approved', note);
  await ctx.audit({ action: 'stock.approveVariance', collection: 'stocktakes', docId: id, campusId: st.campusId, reason: note, after: { lines: diff.length, totalVarianceValue: st.totalVarianceValue } });
  void today;
  return { id, status: 'approved', adjusted: diff.length };
}

registerApprovalHandler('stock_variance', {
  perm: 'campus.manage',
  onApprove: (ctx, a: ApprovalDoc, note) => decideVariance(ctx, a.refId!, 'approved', note, true),
  onReject: (ctx, a: ApprovalDoc, note) => decideVariance(ctx, a.refId!, 'rejected', note, true),
});

// chuyển kho
const transferSend = async (ctx: Ctx, p: any) => {
  const { id: fromCampusId, campus } = await resolveCampus(ctx, p, 'stock.write');
  const toCampusId = needStr(p?.toCampusId, 'toCampusId');
  if (toCampusId === fromCampusId) invalid({ toCampusId: 'Cơ sở nhận phải khác cơ sở giao.' });
  await getCampus(ctx, toCampusId);
  const list: any[] = Array.isArray(p?.lines) ? p.lines : [];
  if (!list.length) invalid({ lines: 'Chưa có mặt hàng.' });
  if (list.length > 40) fail('LIMIT', 'Tối đa 40 mặt hàng một phiếu chuyển.');
  const today = dayKeyOf(ctx.now, tzOf(campus));
  const items = await Promise.all(list.map((l) => getInCampus(ctx, 'stockItems', l?.itemId, fromCampusId, 'Mặt hàng')));
  const id = `tf_${ctx.opId}`;
  const out = await ctx.tx(async (t) => {
    const reads = await Promise.all(items.map(async (it) => ({ is: await t.get(ctx.doc(`stockItems/${it.id}`)), lots: await t.get(ctx.col('stockLots').where('itemId', '==', it.id).where('status', '==', 'active')) })));
    const lines: any[] = [];
    for (const [i, it] of items.entries()) {
      if (it.campusId !== fromCampusId) invalid({ [`lines[${i}].itemId`]: 'Mặt hàng không thuộc cơ sở giao.' });
      const { qty } = toBase(it, list[i].qty, list[i].unit);
      const cur = { id: it.id, ...(reads[i].is.data() as any) } as Doc;
      const r = await issueTx(ctx, t, cur, reads[i].is.data()?.version, reads[i].lots, qty, today, 'transfer_out', `mv_${ctx.opId}_${i}`, { transferId: id, toCampusId, allowNegative: false });
      if (r.shortage > 0) fail('PRECONDITION', `Không đủ tồn để chuyển ${it.name} (thiếu ${r.shortage} ${it.unit}).`, { reason: 'INSUFFICIENT_STOCK', itemId: it.id });
      const lotDocs = r.picks.map((pk) => ({ lot: pk.lot, qty: pk.qty, unitCost: pk.unitCost, expiry: reads[i].lots.docs.find((d) => d.id === pk.lotId)?.data().expiry ?? null }));
      lines.push({ itemId: it.id, code: it.code, name: it.name, unit: it.unit, qty, lots: lotDocs });
    }
    t.set(ctx.doc(`stockTransfers/${id}`), { campusId: fromCampusId, fromCampusId, toCampusId, status: 'in_transit', lines, note: p?.note ?? null, sentBy: ctx.uid, sentAt: Timestamp.now(), ...ctx.metaCreate() });
    return lines;
  });
  await ctx.audit({ action: 'stock.transfer.send', collection: 'stockTransfers', docId: id, campusId: fromCampusId, after: { toCampusId, lines: out.length } });
  return { id, status: 'in_transit', lines: out };
};

const transferReceive = async (ctx: Ctx, p: any) => {
  const tf = await getInCampus(ctx, 'stockTransfers', p?.id, null, 'Phiếu chuyển kho');
  ctx.require('stock.write', tf.toCampusId); // bên NHẬN xác nhận
  if (tf.status !== 'in_transit') fail('INVALID_STATE', 'Phiếu chuyển kho không ở trạng thái đang vận chuyển.');
  const recv: Record<string, number> = {};
  for (const r of Array.isArray(p?.lines) ? p.lines : []) { if (typeof r?.itemId === 'string' && typeof r?.qtyReceived === 'number' && r.qtyReceived >= 0) recv[r.itemId] = r.qtyReceived; }
  const missing: string[] = []; const targets = new Map<string, Doc>();
  for (const l of tf.lines as any[]) {
    const m = asDocs(await ctx.col('stockItems').where('campusId', '==', tf.toCampusId).where('code', '==', l.code).get())[0];
    if (!m) missing.push(l.code); else targets.set(l.itemId, m);
  }
  if (missing.length) fail('PRECONDITION', `Cơ sở nhận chưa có mặt hàng mã: ${missing.join(', ')}. Tạo danh mục trước khi nhận.`, { reason: 'ITEM_MISSING', codes: missing });
  let variance = false;
  await ctx.tx(async (t) => {
    const cur = await t.get(ctx.doc(`stockTransfers/${tf.id}`));
    if (cur.data()?.status !== 'in_transit') fail('INVALID_STATE', 'Phiếu đã được nhận.');
    const itemSnaps = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const l of tf.lines as any[]) itemSnaps.set(l.itemId, await t.get(ctx.doc(`stockItems/${targets.get(l.itemId)!.id}`)));
    const now = Timestamp.now();
    for (const l of tf.lines as any[]) {
      const target = targets.get(l.itemId)!;
      let remain = recv[l.itemId] ?? l.qty;
      if (remain !== l.qty) variance = true;
      const total = remain;
      l.qtyReceived = remain;
      (l.lots as any[]).forEach((lt, i) => {
        const q = i === l.lots.length - 1 ? remain : Math.min(lt.qty, remain);
        remain = q3(remain - q);
        if (q <= 0) return;
        t.set(ctx.doc(`stockLots/in_${tf.id}_${l.itemId}_${i}`), { itemId: target.id, campusId: tf.toCampusId, lot: lt.lot, expiry: lt.expiry ?? null, qtyReceived: q, qtyRemaining: q, unitCost: lt.unitCost, supplier: null, status: 'active', receivedAt: now, transferId: tf.id, ...ctx.metaCreate() });
        t.set(ctx.doc(`stockMovements/in_${tf.id}_${l.itemId}_${i}`), { itemId: target.id, campusId: tf.toCampusId, lotId: `in_${tf.id}_${l.itemId}_${i}`, type: 'transfer_in', qty: q, unitCost: lt.unitCost, value: stockValue(q, lt.unitCost), transferId: tf.id, at: now, ...ctx.metaCreate() });
      });
      const sn = itemSnaps.get(l.itemId)!;
      t.update(ctx.doc(`stockItems/${target.id}`), patchOf(ctx, sn.data()?.version, { onHand: q3((sn.data()?.onHand ?? 0) + total) }));
    }
    t.update(ctx.doc(`stockTransfers/${tf.id}`), patchOf(ctx, cur.data()?.version, { status: variance ? 'received_with_variance' : 'received', lines: tf.lines, receivedBy: ctx.uid, receivedAt: now, receiveNote: p?.note ?? null }));
  });
  await ctx.audit({ action: 'stock.transfer.receive', collection: 'stockTransfers', docId: tf.id, campusId: tf.toCampusId, after: { variance } });
  return { id: tf.id, status: variance ? 'received_with_variance' : 'received' };
};

// ---------------------------------------------------------------- tài sản
const ASSET_FLOW: Record<string, string[]> = {
  created: ['handed_over'],
  handed_over: ['in_use', 'transferred', 'disposed'],
  in_use: ['repair_requested', 'transferred', 'disposed'],
  repair_requested: ['repair_assigned'],
  repair_assigned: ['repair_accepted'],
  repair_accepted: ['in_use'],
  transferred: ['handed_over', 'in_use'],
  disposed: [],
};

const assetTransition = async (ctx: Ctx, p: any) => {
  const a = await getInCampus(ctx, 'assets', p?.assetId, null, 'Tài sản');
  ctx.require('assets.write', a.campusId);
  const to = needStr(p?.to, 'to', 30);
  const allowed = ASSET_FLOW[a.status] ?? [];
  if (!allowed.includes(to)) fail('INVALID_STATE', `Không thể chuyển tài sản từ "${a.status}" sang "${to}". Cho phép: ${allowed.join(', ') || '(trạng thái cuối)'}.`, { allowed });
  const note = typeof p?.note === 'string' ? p.note.trim() : '';
  let assignee: string | null = typeof p?.assigneeUid === 'string' && p.assigneeUid ? p.assigneeUid : null;
  if (assignee) {
    const m = await ctx.doc(`members/${assignee}`).get();
    if (!m.exists || m.data()?.kind === 'parent') invalid({ assigneeUid: 'Người phụ trách phải là nhân viên của tổ chức.' });
  }
  if (['handed_over', 'repair_assigned'].includes(to) && !assignee) invalid({ assigneeUid: 'Bước này cần chỉ định người chịu trách nhiệm.' });
  if (['disposed', 'repair_requested'].includes(to) && note.length < 5) invalid({ note: 'Cần ghi lý do/mô tả (tối thiểu 5 ký tự).' });
  const patch: Record<string, unknown> = { status: to, lastTransitionAt: Timestamp.now() };
  if (to === 'handed_over' || to === 'in_use' || to === 'transferred') { if (assignee) patch.responsibleUid = assignee; }
  if (to === 'repair_assigned') patch.repairAssigneeUid = assignee;
  if (to === 'repair_accepted') patch.repairAssigneeUid = null;
  let toCampus: string | null = null;
  if (to === 'transferred') {
    toCampus = needStr(p?.toCampusId, 'toCampusId');
    if (toCampus !== a.campusId) { await getCampus(ctx, toCampus); ctx.require('assets.write', toCampus); patch.campusId = toCampus; }
    if (p?.room) patch.room = String(p.room).slice(0, 60);
  }
  if (to === 'disposed') { patch.disposedAt = Timestamp.now(); patch.disposeReason = note; }
  // Yêu cầu sửa gắn với assetRequests
  if (to === 'repair_requested') {
    patch.repairRequestId = await createDoc(ctx, 'assetRequests', undefined, { assetId: a.id, campusId: a.campusId, title: `Sửa: ${a.name}`, description: note, priority: p?.priority ?? 'normal', status: 'open', requestedBy: ctx.uid });
  } else if (a.repairRequestId && (to === 'repair_assigned' || to === 'repair_accepted')) {
    await ctx.doc(`assetRequests/${a.repairRequestId}`).update({ status: to === 'repair_assigned' ? 'assigned' : 'closed', assigneeUid: assignee, updatedAt: Timestamp.now(), updatedBy: ctx.uid });
  }
  await updateDoc(ctx, ctx.doc(`assets/${a.id}`), { ...patch, history: (a.history ?? 0) + 1 });
  const h = await ctx.col(`assets/${a.id}/history`).add({ from: a.status, to, at: Timestamp.now(), by: ctx.uid, assigneeUid: assignee, note, fromCampusId: a.campusId, toCampusId: toCampus ?? a.campusId, responsibleUid: (patch.responsibleUid as string | undefined) ?? a.responsibleUid ?? null });
  await ctx.audit({ action: 'asset.transition', collection: 'assets', docId: a.id, campusId: a.campusId, reason: note, before: { status: a.status }, after: { status: to, assignee } });
  return { assetId: a.id, status: to, historyId: h.id };
};

// ---------------------------------------------------------------- đưa đón
async function tripOf(ctx: Ctx, id: unknown, expect: string[]): Promise<Doc> {
  const trip = await getInCampus(ctx, 'trips', id, null, 'Chuyến xe');
  ctx.require('transport.write', trip.campusId);
  if (!expect.includes(trip.status)) fail('INVALID_STATE', `Chuyến xe đang ở trạng thái "${trip.status}".`, { status: trip.status });
  return trip;
}

const tripStart = async (ctx: Ctx, p: any) => {
  const trip = await tripOf(ctx, p?.tripId, ['planned']);
  const route = await getInCampus(ctx, 'routes', trip.routeId, trip.campusId, 'Tuyến');
  const ids: string[] = route.childIds ?? [];
  const kids = (await Promise.all(ids.map((id) => ctx.doc(`children/${id}`).get()))).filter((s) => s.exists && s.data()?.campusId === trip.campusId && ['active', 'trial'].includes(s.data()?.status));
  const now = Timestamp.now();
  await commitOps([
    ...kids.map((k) => (b: FirebaseFirestore.WriteBatch) => b.set(ctx.doc(`trips/${trip.id}/riders/${k.id}`), { childId: k.id, childName: childName(k.data()!), campusId: trip.campusId, status: 'expected', registered: true, ...ctx.metaCreate() })),
  ]);
  await updateDoc(ctx, ctx.doc(`trips/${trip.id}`), { status: 'in_progress', startedAt: now, startedBy: ctx.uid, expectedCount: kids.length, onboardCount: 0 });
  await ctx.audit({ action: 'trip.start', collection: 'trips', docId: trip.id, campusId: trip.campusId, after: { expected: kids.length } });
  return { tripId: trip.id, status: 'in_progress', expected: kids.length };
};

async function riderTx(ctx: Ctx, trip: Doc, childId: unknown, fn: (rider: FirebaseFirestore.DocumentData | undefined, t: FirebaseFirestore.Transaction, rref: FirebaseFirestore.DocumentReference, tripVersion: number, onboard: number) => unknown) {
  if (typeof childId !== 'string' || !SAFE_ID.test(childId)) invalid({ childId: 'Bắt buộc.' });
  return ctx.tx(async (t) => {
    const rref = ctx.doc(`trips/${trip.id}/riders/${childId}`);
    const [rs, ts] = await Promise.all([t.get(rref), t.get(ctx.doc(`trips/${trip.id}`))]);
    if (ts.data()?.status !== 'in_progress') fail('INVALID_STATE', 'Chuyến xe không còn đang chạy.');
    return fn(rs.data(), t, rref, ts.data()?.version ?? 0, ts.data()?.onboardCount ?? 0);
  });
}

const tripBoard = async (ctx: Ctx, p: any) => {
  const trip = await tripOf(ctx, p?.tripId, ['in_progress']);
  const at = toDate(p?.at) ?? ctx.now;
  return riderTx(ctx, trip, p?.childId, (rider, t, rref, tv, onboard) => {
    if (!rider) {
      if (p?.allowUnregistered !== true) fail('PRECONDITION', 'Trẻ không có trong danh sách đăng ký của chuyến. Xác nhận ngoại lệ (allowUnregistered) kèm ghi chú nếu thực sự lên xe.', { reason: 'NOT_REGISTERED' });
      if (typeof p?.note !== 'string' || p.note.trim().length < 3) invalid({ note: 'Trẻ ngoài danh sách: bắt buộc ghi chú.' });
      t.set(rref, { childId: p.childId, campusId: trip.campusId, status: 'onboard', registered: false, boardedAt: Timestamp.fromDate(at), boardedBy: ctx.uid, stop: p?.stopName ?? null, note: p.note, ...ctx.metaCreate() });
    } else {
      if (rider.status !== 'expected') fail('CONFLICT', rider.status === 'onboard' ? 'Trẻ đã lên xe.' : `Trẻ đã ở trạng thái "${rider.status}".`);
      t.update(rref, patchOf(ctx, rider.version, { status: 'onboard', boardedAt: Timestamp.fromDate(at), boardedBy: ctx.uid, stop: p?.stopName ?? null }));
    }
    t.update(ctx.doc(`trips/${trip.id}`), patchOf(ctx, tv, { onboardCount: onboard + 1 }));
    t.set(ctx.doc(`trips/${trip.id}/events/${ctx.opId ?? ctx.requestId}`), { type: 'board', childId: p.childId, at: Timestamp.fromDate(at), by: ctx.uid, stop: p?.stopName ?? null });
    return { tripId: trip.id, childId: p.childId, status: 'onboard', onboardCount: onboard + 1 };
  });
};

const tripAlight = async (ctx: Ctx, p: any) => {
  const trip = await tripOf(ctx, p?.tripId, ['in_progress']);
  const at = toDate(p?.at) ?? ctx.now;
  return riderTx(ctx, trip, p?.childId, (rider, t, rref, tv, onboard) => {
    if (!rider || rider.status !== 'onboard') fail('PRECONDITION', 'Trẻ chưa lên xe (không ở trạng thái đang trên xe).', { reason: 'NOT_ONBOARD' });
    t.update(rref, patchOf(ctx, rider.version, { status: 'alighted', alightedAt: Timestamp.fromDate(at), alightedBy: ctx.uid, place: typeof p?.place === 'string' ? p.place.slice(0, 100) : null }));
    t.update(ctx.doc(`trips/${trip.id}`), patchOf(ctx, tv, { onboardCount: Math.max(0, onboard - 1) }));
    t.set(ctx.doc(`trips/${trip.id}/events/${ctx.opId ?? ctx.requestId}`), { type: 'alight', childId: p.childId, at: Timestamp.fromDate(at), by: ctx.uid, place: p?.place ?? null });
    return { tripId: trip.id, childId: p.childId, status: 'alighted', onboardCount: Math.max(0, onboard - 1) };
  });
};

const tripHandover = async (ctx: Ctx, p: any) => {
  const trip = await tripOf(ctx, p?.tripId, ['in_progress']);
  const rb = p?.receivedBy;
  if (!rb || typeof rb.name !== 'string' || !rb.name.trim() || typeof rb.relation !== 'string' || !rb.relation.trim()) invalid({ receivedBy: 'Cần họ tên và quan hệ của người nhận trẻ.' });
  if (trip.direction === 'to_home') {
    if (typeof rb.pickupPersonId === 'string') {
      const pa = await ctx.doc(`pickupAuthorizations/${rb.pickupPersonId}`).get();
      const d = pa.data();
      const day = dayKeyOf(ctx.now);
      if (!pa.exists || d?.childId !== p?.childId || d?.status !== 'approved' || d?.revoked === true || (d?.validTo && d.validTo < day) || (d?.validFrom && d.validFrom > day)) {
        fail('PRECONDITION', 'Người nhận không có ủy quyền đón hiệu lực (chưa duyệt, đã thu hồi hoặc hết hạn).', { reason: 'PICKUP_NOT_AUTHORIZED' });
      }
    } else if (typeof p?.verification?.method !== 'string') invalid({ verification: 'Cần xác minh người nhận (pickupPersonId hoặc verification.method).' });
  }
  const at = toDate(p?.at) ?? ctx.now;
  return riderTx(ctx, trip, p?.childId, (rider, t, rref, tv, onboard) => {
    if (!rider || !['onboard', 'alighted'].includes(rider.status)) fail('PRECONDITION', 'Trẻ chưa lên xe nên chưa thể bàn giao.', { reason: 'NOT_ONBOARD' });
    t.update(rref, patchOf(ctx, rider.version, { status: 'handed_over', handedOverAt: Timestamp.fromDate(at), handedOverBy: ctx.uid, receivedBy: { name: rb.name, relation: rb.relation, pickupPersonId: rb.pickupPersonId ?? null }, verification: p?.verification ?? null }));
    if (rider.status === 'onboard') t.update(ctx.doc(`trips/${trip.id}`), patchOf(ctx, tv, { onboardCount: Math.max(0, onboard - 1) }));
    t.set(ctx.doc(`trips/${trip.id}/events/${ctx.opId ?? ctx.requestId}`), { type: 'handover', childId: p.childId, at: Timestamp.fromDate(at), by: ctx.uid, receivedBy: rb.name });
    return { tripId: trip.id, childId: p.childId, status: 'handed_over' };
  });
};

const tripEndCheck = async (ctx: Ctx, p: any) => {
  const trip = await tripOf(ctx, p?.tripId, ['in_progress']);
  if (typeof p?.vehicleEmpty !== 'boolean') invalid({ vehicleEmpty: 'Phải xác nhận đã kiểm tra xe sau chuyến (true/false).' });
  if (!Number.isInteger(p?.countedOnboard) || p.countedOnboard < 0) invalid({ countedOnboard: 'Nhập số trẻ đếm thực tế còn trên xe (số nguyên ≥ 0).' });
  const riders = asDocs(await ctx.col(`trips/${trip.id}/riders`).get());
  const by = (s: string) => riders.filter((r) => r.status === s);
  const onboard = by('onboard');
  const summary = { expected: riders.filter((r) => r.registered !== false).length, boarded: riders.filter((r) => r.boardedAt).length, alighted: by('alighted').length, handedOver: by('handed_over').length, stillOnboard: onboard.length, noShow: by('expected').map((r) => r.childId), countedOnboard: p.countedOnboard };
  // Đối chiếu số trẻ TRÊN XE (không dùng điểm danh lớp): hệ thống phải bằng số đếm thực tế và bằng 0.
  const problems: string[] = [];
  if (onboard.length > 0) problems.push(`Hệ thống còn ${onboard.length} trẻ chưa xuống xe/bàn giao.`);
  if (p.countedOnboard !== onboard.length) problems.push(`Số trẻ đếm thực tế (${p.countedOnboard}) khác hệ thống (${onboard.length}).`);
  if (!p.vehicleEmpty) problems.push('Kiểm tra xe sau chuyến chưa xác nhận xe đã trống.');
  if (problems.length) {
    const alertId = await createDoc(ctx, 'alerts', undefined, { type: 'trip_discrepancy', severity: 'critical', campusId: trip.campusId, refCollection: 'trips', refId: trip.id, title: 'Chênh lệch số trẻ trên xe', message: problems.join(' '), childIds: onboard.map((r) => r.childId), status: 'open' });
    await updateDoc(ctx, ctx.doc(`trips/${trip.id}`), { status: 'needs_review', endCheck: { ...summary, problems, at: Timestamp.now(), by: ctx.uid }, alertId });
    await ctx.audit({ action: 'trip.endCheck.discrepancy', collection: 'trips', docId: trip.id, campusId: trip.campusId, after: { problems } });
    fail('PRECONDITION', `Không thể kết thúc chuyến: ${problems.join(' ')}`, { reason: 'TRIP_DISCREPANCY', summary, alertId, onboard: onboard.map((r) => r.childId) });
  }
  await updateDoc(ctx, ctx.doc(`trips/${trip.id}`), { status: 'completed', endedAt: Timestamp.now(), endedBy: ctx.uid, endCheck: { ...summary, problems: [], vehicleEmpty: true, at: Timestamp.now(), by: ctx.uid, note: p?.note ?? null } });
  await ctx.audit({ action: 'trip.endCheck', collection: 'trips', docId: trip.id, campusId: trip.campusId, after: summary });
  return { tripId: trip.id, status: 'completed', summary };
};

const needDec = needDecision;
export const actions: ActionMap = {
  'menu.submit': { scope: 'org', perm: 'kitchen.write', handler: menuSubmit },
  'menu.approve': { scope: 'org', perm: 'campus.manage', handler: (ctx, p: any) => decideMenu(ctx, p?.id, needDec(p?.decision ?? 'approved'), p?.note, false) },
  'menu.publish': { scope: 'org', perm: 'kitchen.write', handler: menuPublish },
  'meal.lock': { scope: 'org', perm: 'kitchen.write', handler: mealLock },
  'meal.recordServed': { scope: 'org', perm: 'kitchen.write', handler: mealRecordServed },
  'stock.receive': { scope: 'org', perm: 'stock.write', idempotent: true, handler: stockReceive },
  'stock.issue': { scope: 'org', perm: 'stock.write', idempotent: true, handler: stockIssue },
  'stock.stocktake': { scope: 'org', perm: 'stock.write', handler: stockStocktake },
  'stock.approveVariance': { scope: 'org', perm: 'campus.manage', handler: (ctx, p: any) => decideVariance(ctx, p?.id, needDec(p?.decision ?? 'approved'), p?.note, false) },
  'stock.transfer.send': { scope: 'org', perm: 'stock.write', idempotent: true, handler: transferSend },
  'stock.transfer.receive': { scope: 'org', perm: 'stock.write', idempotent: true, handler: transferReceive },
  'asset.transition': { scope: 'org', perm: 'assets.write', handler: assetTransition },
  'trip.start': { scope: 'org', perm: 'transport.write', handler: tripStart },
  'trip.board': { scope: 'org', perm: 'transport.write', handler: tripBoard },
  'trip.alight': { scope: 'org', perm: 'transport.write', handler: tripAlight },
  'trip.handover': { scope: 'org', perm: 'transport.write', handler: tripHandover },
  'trip.endCheck': { scope: 'org', perm: 'transport.write', handler: tripEndCheck },
};

void validate; void addDays;
