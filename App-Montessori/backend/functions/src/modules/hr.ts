// Nhân sự & chấm công (W21–W26). Xem docs/CONTRACT.md §4 "Nhân sự & công" và docs/BUSINESS.txt mục 7–8.
import type { ActionMap, Ctx } from '../core/types';
import { Timestamp } from '../core/firebase';
import { fail, invalid } from '../core/errors';
import { createDoc, getCampus, updateDoc, dayKeyOf, hhmmOf } from '../core/store';
import { registerEntity } from '../core/entity-registry';
import { registerApprovalHandler, createApproval, ApprovalDoc } from '../core/approvals';
import { validate, isValidDay, requireRange } from '../core/validate';
import {
  asDocs, commitOps, Doc, employeeIdOf, getInCampus, needDay, needDecision, needStr, resolveCampus, separateDuties, syncApproval, toDate, tzOf, ts,
} from '../lib/common';
import {
  assignedAt, computeShortages, countWorkDays, effectiveRange, getEmployee, isPeriodLocked, notifyEmployee, shiftWindow, snapshotOfShift,
} from '../lib/hr-common';
import { addDays, dayIndex, distanceM, listDays, minutesSinceDayStart, overlaps, periodRange, zonedTimeToDate } from '../lib/time';
import { actions as timesheetActions } from './hr-timesheet';

// ---------------------------------------------------------------- Entity: shifts, rosters
registerEntity('shifts', {
  writePerm: 'roster.write', campusScoped: true, uniqueBy: ['code'], idPrefix: 'sh_',
  schema: {
    code: { t: 'string', req: true, max: 20 }, name: { t: 'string', req: true, max: 100 },
    startTime: { t: 'time', req: true }, endTime: { t: 'time', req: true },
    breakMinutes: { t: 'int', min: 0, max: 600 }, lateGraceMinutes: { t: 'int', min: 0, max: 180 },
    earlyGraceMinutes: { t: 'int', min: 0, max: 180 }, roundTo: { t: 'int', min: 1, max: 60 },
    workUnit: { t: 'number', min: 0, max: 3 }, unitPolicy: { t: 'string', oneOf: ['full', 'proportional'] },
    active: { t: 'bool' }, color: { t: 'string', max: 20 }, note: { t: 'string', max: 500 },
  },
  async beforeSave(_ctx, data) {
    if (data.startTime && data.endTime && data.startTime === data.endTime) invalid({ endTime: 'Giờ kết thúc phải khác giờ bắt đầu.' });
    const end = data.endTime as string | undefined; const start = data.startTime as string | undefined;
    return { ...(start && end ? { overnight: end <= start } : {}), breakMinutes: data.breakMinutes ?? 0 };
  },
});

registerEntity('rosters', {
  writePerm: 'roster.write', campusScoped: true, idPrefix: 'ros_',
  schema: {
    fromDay: { t: 'day', req: true }, toDay: { t: 'day', req: true }, note: { t: 'string', max: 500 },
    status: { t: 'string', oneOf: ['draft'] },
  },
  async beforeSave(_ctx, data) { requireRange(data.fromDay, data.toDay, 'fromDay', 'toDay'); return { status: 'draft' }; },
  editableStatuses: ['draft'],
});

// ---------------------------------------------------------------- employee.save / employee.assign
const EMP_SCHEMA = {
  code: { t: 'string', req: true, min: 1, max: 30 } as const, fullName: { t: 'string', req: true, min: 2, max: 150 } as const,
  phone: { t: 'string', max: 20 } as const, email: { t: 'string', max: 150 } as const, title: { t: 'string', max: 100 } as const,
  status: { t: 'string', oneOf: ['active', 'on_leave', 'resigned'] } as const,
  startDate: { t: 'day' } as const, endDate: { t: 'day' } as const, dob: { t: 'day' } as const,
  gender: { t: 'string', oneOf: ['male', 'female', 'other'] } as const,
  annualLeaveDays: { t: 'int', min: 0, max: 60 } as const, note: { t: 'string', max: 1000 } as const,
};
const CONTRACT_SCHEMA = {
  type: { t: 'string', req: true, oneOf: ['probation', 'fixed_term', 'indefinite', 'part_time', 'service'] } as const,
  startDate: { t: 'day', req: true } as const, endDate: { t: 'day' } as const, position: { t: 'string', max: 100 } as const,
  standardDays: { t: 'number', min: 1, max: 31 } as const, status: { t: 'string', oneOf: ['active', 'ended', 'cancelled'] } as const,
  note: { t: 'string', max: 500 } as const,
};

const employeeSave = async (ctx: Ctx, p: any) => {
  const campusId = (p?.campusId as string) || ctx.campusId;
  if (!campusId) invalid({ campusId: 'Bắt buộc chọn cơ sở chính.' });
  await getCampus(ctx, campusId);
  ctx.require('staff.write', campusId);
  const data = validate<any>(p, EMP_SCHEMA, { partial: !!p?.id });
  if (data.startDate && data.endDate && data.startDate > data.endDate) invalid({ endDate: 'Ngày nghỉ việc phải sau ngày vào làm.' });
  const id: string | undefined = p?.id;
  let existing: Doc | null = null;
  if (id) {
    existing = await getInCampus(ctx, 'employees', id, null, 'Nhân viên');
    ctx.require('staff.write', existing.campusId); // không tin client: quyền theo cơ sở của hồ sơ hiện có
  }
  if (data.code) {
    const dup = asDocs(await ctx.col('employees').where('code', '==', data.code).get()).find((d) => d.id !== id);
    if (dup) invalid({ code: 'Mã nhân viên đã tồn tại.' });
  }
  // hợp đồng: không chồng lấn hiệu lực
  const contracts: any[] = Array.isArray(p?.contracts) ? p.contracts : [];
  const cleaned = contracts.map((c, i) => {
    let v: any;
    try { v = validate<any>(c, CONTRACT_SCHEMA); } catch (e: any) { invalid({ [`contracts[${i}]`]: JSON.stringify(e?.details?.fieldErrors ?? {}) }); }
    if (v.endDate && v.endDate < v.startDate) invalid({ [`contracts[${i}].endDate`]: 'Ngày kết thúc hợp đồng phải sau ngày bắt đầu.' });
    return { id: typeof c.id === 'string' ? c.id : undefined, ...v, status: v.status ?? 'active' };
  });
  const live = cleaned.filter((c) => c.status === 'active');
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i]; const b = live[j];
    if ((!a.endDate || a.endDate >= b.startDate) && (!b.endDate || b.endDate >= a.startDate)) invalid({ contracts: 'Hai hợp đồng đang hiệu lực không được chồng thời gian.' });
  }
  // liên kết tài khoản
  let linkUid: string | undefined;
  if (typeof p?.uid === 'string' && p.uid && p.uid !== existing?.uid) {
    ctx.require('members.manage', campusId);
    const m = await ctx.doc(`members/${p.uid}`).get();
    if (!m.exists || m.data()?.kind === 'parent') invalid({ uid: 'Tài khoản không phải nhân viên của tổ chức này.' });
    const other = m.data()?.employeeId;
    if (other && other !== id) fail('CONFLICT', 'Tài khoản đã liên kết với nhân viên khác.');
    linkUid = p.uid;
  }
  let empId = id;
  let before: unknown = null;
  if (existing) {
    const { before: b } = await updateDoc(ctx, ctx.doc(`employees/${id}`), { ...data, ...(linkUid ? { uid: linkUid } : {}) }, p.expectedVersion);
    before = b;
  } else {
    empId = await createDoc(ctx, 'employees', undefined, {
      status: 'active', ...data, campusId, campusIds: [campusId], archived: false, ...(linkUid ? { uid: linkUid } : {}),
    });
  }
  if (linkUid) await ctx.doc(`members/${linkUid}`).update({ employeeId: empId, updatedAt: Timestamp.now(), updatedBy: ctx.uid });
  const contractIds: string[] = [];
  for (const c of cleaned) {
    const { id: cid, ...rest } = c;
    if (cid) {
      const cur = await getInCampus(ctx, 'contracts', cid, null, 'Hợp đồng');
      if (cur.employeeId !== empId) fail('NOT_FOUND', 'Hợp đồng không thuộc nhân viên này.');
      await updateDoc(ctx, ctx.doc(`contracts/${cid}`), rest);
      contractIds.push(cid);
    } else {
      contractIds.push(await createDoc(ctx, 'contracts', undefined, { ...rest, employeeId: empId, campusId: existing?.campusId ?? campusId }));
    }
  }
  // tài khoản ngân hàng: chỉ người có quyền lương/kế toán ghi (không nằm trong doc staff.read)
  if (p?.bank && typeof p.bank === 'object') {
    ctx.require('payroll.write', existing?.campusId ?? campusId);
    const b = validate<any>(p.bank, { bankName: { t: 'string', max: 100 }, accountNo: { t: 'string', max: 40 }, accountName: { t: 'string', max: 100 } });
    await ctx.doc(`employees/${empId}/private/bank`).set({ ...b, updatedAt: Timestamp.now(), updatedBy: ctx.uid }, { merge: true });
  }
  await ctx.audit({ action: existing ? 'employee.update' : 'employee.create', collection: 'employees', docId: empId, campusId: existing?.campusId ?? campusId, before, after: { ...data, contractIds } });
  const cur = await ctx.doc(`employees/${empId}`).get();
  return { id: empId, version: cur.data()?.version, contractIds };
};

const employeeAssign = async (ctx: Ctx, p: any) => {
  const { id: campusId } = await resolveCampus(ctx, p, 'staff.write');
  const emp = await getEmployee(ctx, p?.employeeId);
  const d = validate<any>(p, {
    title: { t: 'string', req: true, max: 100 }, fromDay: { t: 'day', req: true }, toDay: { t: 'day' },
    classId: { t: 'string', max: 128 }, role: { t: 'string', max: 50 }, primary: { t: 'bool' },
  });
  if (d.toDay) requireRange(d.fromDay, d.toDay);
  if (d.classId) {
    const cls = await getInCampus(ctx, 'classes', d.classId, campusId, 'Lớp');
    if (cls.campusId !== campusId) fail('NOT_FOUND', 'Lớp không thuộc cơ sở này.');
  }
  const existing = asDocs(await ctx.col('staffAssignments').where('employeeId', '==', emp.id).get()).filter((a) => a.status !== 'cancelled');
  const clash = existing.find((a) => a.campusId === campusId && (a.classId ?? null) === (d.classId ?? null)
    && (!a.toDay || a.toDay >= d.fromDay) && (!d.toDay || d.toDay >= a.fromDay) && a.id !== p.id);
  if (clash) fail('CONFLICT', 'Nhân viên đã có đợt phân công trùng thời gian tại cơ sở/lớp này.', { conflictId: clash.id });
  const id = await createDoc(ctx, 'staffAssignments', undefined, { ...d, employeeId: emp.id, campusId, status: 'active' });
  // Một người nhiều cơ sở: campusIds = hợp các cơ sở có phân công chưa kết thúc + cơ sở chính.
  const today = dayKeyOf(ctx.now);
  const all = [...existing, { campusId, toDay: d.toDay }].filter((a) => !a.toDay || a.toDay >= today);
  const campusIds = [...new Set([emp.campusId, ...all.map((a) => a.campusId)].filter(Boolean))];
  await ctx.doc(`employees/${emp.id}`).update({ campusIds, updatedAt: Timestamp.now(), updatedBy: ctx.uid, version: (emp.version ?? 0) + 1 });
  await ctx.audit({ action: 'employee.assign', collection: 'staffAssignments', docId: id, campusId, after: { employeeId: emp.id, ...d } });
  return { id, campusIds, note: 'Lịch ca của nhân viên làm nhiều cơ sở được kiểm tra không trùng khi công bố lịch (roster.publish).' };
};

// ---------------------------------------------------------------- roster.publish
interface RawEntry { employeeId: string; dayKey: string; shiftId: string }

const rosterPublish = async (ctx: Ctx, p: any) => {
  const { id: campusId, campus } = await resolveCampus(ctx, p, 'roster.write');
  const fromDay = needDay(p?.fromDay, 'fromDay'); const toDay = needDay(p?.toDay, 'toDay');
  requireRange(fromDay, toDay);
  if (dayIndex(toDay) - dayIndex(fromDay) > 62) invalid({ toDay: 'Một lần công bố tối đa 62 ngày.' });
  const raw: RawEntry[] = Array.isArray(p?.entries) ? p.entries : [];
  if (raw.length > 6000) fail('LIMIT', 'Tối đa 6000 mục lịch một lần công bố.');
  const tz = tzOf(campus); const today = dayKeyOf(ctx.now, tz);

  const shifts = new Map(asDocs(await ctx.col('shifts').where('campusId', '==', campusId).get()).filter((s) => s.active !== false && !s.archived).map((s) => [s.id, s]));
  const empCache = new Map<string, Doc>();
  const errors: Array<{ index: number; field?: string; message: string }> = [];
  const seen = new Set<string>();
  const entries: Array<RawEntry & { snap: ReturnType<typeof snapshotOfShift>; start: number; end: number }> = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] ?? ({} as RawEntry);
    if (typeof e.employeeId !== 'string' || !isValidDay(e.dayKey) || typeof e.shiftId !== 'string') { errors.push({ index: i, message: 'Mục lịch thiếu nhân viên, ngày hoặc ca.' }); continue; }
    if (e.dayKey < fromDay || e.dayKey > toDay) { errors.push({ index: i, field: 'dayKey', message: `Ngày ${e.dayKey} ngoài khoảng công bố.` }); continue; }
    const sh = shifts.get(e.shiftId);
    if (!sh) { errors.push({ index: i, field: 'shiftId', message: 'Ca không tồn tại ở cơ sở này hoặc đã ngừng dùng.' }); continue; }
    const key = `${e.employeeId}_${e.dayKey}_${e.shiftId}`;
    if (seen.has(key)) { errors.push({ index: i, message: 'Mục lịch bị lặp.' }); continue; }
    seen.add(key);
    let emp: Doc;
    const cached = empCache.get(e.employeeId);
    if (cached) emp = cached;
    else {
      const s = await ctx.doc(`employees/${e.employeeId}`).get();
      if (!s.exists) { errors.push({ index: i, field: 'employeeId', message: 'Nhân viên không tồn tại.' }); continue; }
      emp = { id: s.id, ...(s.data() as any) }; empCache.set(e.employeeId, emp);
    }
    if (emp.status === 'resigned' || (emp.endDate && emp.endDate < e.dayKey)) { errors.push({ index: i, field: 'employeeId', message: `${emp.fullName} đã nghỉ việc trước ngày ${e.dayKey}.` }); continue; }
    if (!(await assignedAt(ctx, emp, campusId, e.dayKey))) { errors.push({ index: i, field: 'employeeId', message: `${emp.fullName} chưa được phân công tại cơ sở này vào ngày ${e.dayKey}.` }); continue; }
    const snap = snapshotOfShift(sh); const w = shiftWindow(snap);
    entries.push({ ...e, snap, ...w });
  }
  if (errors.length) fail('VALIDATION', `Lịch ca có ${errors.length} lỗi. Sửa rồi công bố lại.`, { errors });

  // Kỳ công đã khóa: không đổi lịch (kỳ khóa giữ nguyên ca đã dùng).
  for (const pk of new Set(listDays(fromDay, toDay).map((d) => d.slice(0, 7)))) {
    if (await isPeriodLocked(ctx, campusId, `${pk}-01`)) fail('PRECONDITION', `Kỳ công ${pk} đã khóa; không thể đổi lịch ca. Hãy mở lại kỳ có kiểm soát.`, { reason: 'PERIOD_LOCKED' });
  }

  // Chồng ca: trong chính lịch này + với lịch đã công bố ở cơ sở KHÁC.
  const overlapsFound: Array<{ employeeId: string; dayKey: string; with: string }> = [];
  const byEmp = new Map<string, typeof entries>();
  for (const e of entries) (byEmp.get(e.employeeId) ?? byEmp.set(e.employeeId, []).get(e.employeeId)!).push(e);
  for (const [emp, list] of byEmp) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      const a1 = dayIndex(a.dayKey) * 1440 + a.start; const a2 = dayIndex(a.dayKey) * 1440 + a.end;
      const b1 = dayIndex(b.dayKey) * 1440 + b.start; const b2 = dayIndex(b.dayKey) * 1440 + b.end;
      if (overlaps(a1, a2, b1, b2)) overlapsFound.push({ employeeId: emp, dayKey: a.dayKey, with: `${b.shiftId}@${b.dayKey}` });
    }
  }
  const others = asDocs(await ctx.col('rosterEntries').where('dayKey', '>=', addDays(fromDay, -1)).where('dayKey', '<=', addDays(toDay, 1)).get())
    .filter((o) => o.campusId !== campusId && o.status !== 'superseded' && byEmp.has(o.actualEmployeeId ?? o.employeeId));
  for (const o of others) {
    const oe = o.actualEmployeeId ?? o.employeeId;
    const ow = shiftWindow(o.shiftSnapshot);
    for (const e of byEmp.get(oe) ?? []) {
      if (overlaps(dayIndex(e.dayKey) * 1440 + e.start, dayIndex(e.dayKey) * 1440 + e.end, dayIndex(o.dayKey) * 1440 + ow.start, dayIndex(o.dayKey) * 1440 + ow.end)) {
        overlapsFound.push({ employeeId: oe, dayKey: e.dayKey, with: `cơ sở ${o.campusId} ${o.dayKey} ${o.shiftSnapshot.startTime}-${o.shiftSnapshot.endTime}` });
      }
    }
  }
  if (overlapsFound.length) fail('PRECONDITION', `Có ${overlapsFound.length} ca chồng thời gian; một người ở nhiều cơ sở không được trùng ca.`, { reason: 'SHIFT_OVERLAP', overlaps: overlapsFound.slice(0, 50) });

  // Ngày đã qua: không sửa lịch (không che đi muộn).
  const existing = asDocs(await ctx.col('rosterEntries').where('campusId', '==', campusId).where('dayKey', '>=', fromDay).where('dayKey', '<=', toDay).get());
  const existingActive = existing.filter((x) => x.status !== 'superseded');
  const newKeys = new Set(entries.map((e) => `${e.employeeId}_${e.dayKey}_${e.shiftId}`));
  const pastDiff = [
    ...existingActive.filter((x) => x.dayKey < today && !newKeys.has(x.id)).map((x) => x.id),
    ...entries.filter((e) => e.dayKey < today && !existingActive.some((x) => x.id === `${e.employeeId}_${e.dayKey}_${e.shiftId}`)).map((e) => `${e.employeeId}_${e.dayKey}_${e.shiftId}`),
  ];
  if (pastDiff.length) fail('PRECONDITION', 'Không được thêm/bỏ ca của những ngày đã qua. Dùng điều chỉnh công để xử lý.', { reason: 'PAST_DAY', entries: pastDiff.slice(0, 50) });

  // Thiếu giáo viên: cảnh báo; chặn nếu chưa xác nhận.
  const shortages = await computeShortages(ctx, campusId, entries.map((e) => ({ employeeId: e.employeeId, dayKey: e.dayKey })), campus);
  if (shortages.length && p?.acknowledgeShortage !== true) {
    fail('PRECONDITION', `Thiếu giáo viên ở ${shortages.length} lớp-ngày. Xác nhận (acknowledgeShortage) để vẫn công bố.`, { reason: 'TEACHER_SHORTAGE', shortages: shortages.slice(0, 100) });
  }

  const rosterId = `${campusId}_${fromDay}_${toDay}`;
  const rref = ctx.doc(`rosters/${rosterId}`);
  const rs = await rref.get();
  const prevVersion = (rs.data()?.version as number | undefined) ?? 0;
  const prevMap = new Map(existing.map((x) => [x.id, x]));
  const now = Timestamp.now();
  const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];
  ops.push((b) => b.set(rref, {
    campusId, fromDay, toDay, status: 'published', entryCount: entries.length, shortages: shortages.slice(0, 100), shortageAcknowledged: shortages.length > 0,
    publishedAt: now, publishedBy: ctx.uid, createdAt: rs.data()?.createdAt ?? now, createdBy: rs.data()?.createdBy ?? ctx.uid, updatedAt: now, updatedBy: ctx.uid, version: prevVersion + 1,
  }, { merge: true }));
  for (const e of entries) {
    const id = `${e.employeeId}_${e.dayKey}_${e.shiftId}`;
    const prev = prevMap.get(id);
    ops.push((b) => b.set(ctx.doc(`rosterEntries/${id}`), {
      campusId, employeeId: e.employeeId, dayKey: e.dayKey, shiftId: e.shiftId, shiftSnapshot: e.snap, rosterId,
      // giữ người làm thực tế (đổi ca) và nghỉ phép đã duyệt khi công bố lại
      actualEmployeeId: prev?.actualEmployeeId ?? null, swapId: prev?.swapId ?? null, leaveId: prev?.leaveId ?? null,
      status: prev?.leaveId ? 'on_leave' : 'published',
      createdAt: prev?.createdAt ?? now, createdBy: prev?.createdBy ?? ctx.uid, updatedAt: now, updatedBy: ctx.uid, version: (prev?.version ?? 0) + 1,
    }));
  }
  for (const x of existingActive) {
    if (!newKeys.has(x.id)) ops.push((b) => b.update(ctx.doc(`rosterEntries/${x.id}`), { status: 'superseded', supersededBy: rosterId, updatedAt: now, updatedBy: ctx.uid, version: (x.version ?? 0) + 1 }));
  }
  await commitOps(ops);
  const uids = [...new Set([...empCache.values()].map((e) => e.uid as string | undefined).filter(Boolean) as string[])];
  if (uids.length) {
    const { sendSystemNotification } = await import('../lib/notify');
    await sendSystemNotification(ctx, { campusId, title: 'Lịch ca mới', body: `Lịch ca ${fromDay} → ${toDay} đã được công bố.`, category: 'hr', uids, refCollection: 'rosters', refId: rosterId }).catch(() => undefined);
  }
  await ctx.audit({ action: 'roster.publish', collection: 'rosters', docId: rosterId, campusId, after: { fromDay, toDay, entries: entries.length, shortages: shortages.length } });
  return { rosterId, entries: entries.length, shortages, version: prevVersion + 1 };
};

// ---------------------------------------------------------------- punch.record
const punchRecord = async (ctx: Ctx, p: any) => {
  const opId = ctx.opId!;
  const kind = p?.kind; const source = p?.source ?? 'app';
  if (kind !== 'in' && kind !== 'out') invalid({ kind: 'Loại lượt chấm phải là in hoặc out.' });
  if (!['app', 'device', 'manual'].includes(source)) invalid({ source: 'Nguồn chấm không hợp lệ.' });
  const deviceTime = toDate(p?.deviceTime);
  if (!deviceTime) invalid({ deviceTime: 'Thời gian thiết bị không hợp lệ.' });
  const serverNow = new Date();
  let location: { lat: number; lng: number; accuracy: number | null } | null = null;
  if (p?.location) {
    const { lat, lng, accuracy } = p.location;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) invalid({ location: 'Vị trí không hợp lệ.' });
    location = { lat, lng, accuracy: typeof accuracy === 'number' ? accuracy : null };
  }
  // Ai được chấm: bản thân; chấm hộ/thủ công/máy chấm công cần quyền duyệt công tại cơ sở.
  let employeeId: string;
  const own = ctx.member?.employeeId;
  const targetEmp = typeof p?.employeeId === 'string' ? p.employeeId : undefined;
  const delegated = source !== 'app' || (targetEmp && targetEmp !== own);
  if (delegated) {
    if (!targetEmp) invalid({ employeeId: 'Chấm thủ công/thiết bị cần chỉ rõ nhân viên.' });
    employeeId = targetEmp;
  } else employeeId = employeeIdOf(ctx);
  const emp = await getEmployee(ctx, employeeId);
  const campusId = (p?.campusId as string) || ctx.campusId || emp.campusId;
  const campus = await getCampus(ctx, campusId);
  if (delegated) ctx.require('timekeeping.approve', campusId);
  if (emp.status === 'resigned') fail('PRECONDITION', 'Nhân viên đã nghỉ việc.');
  const tz = tzOf(campus);
  const today = dayKeyOf(serverNow, tz);
  if (!(await assignedAt(ctx, emp, campusId, today))) fail('PRECONDITION', 'Bạn chưa được phân công làm việc tại cơ sở này hôm nay.', { reason: 'NOT_ASSIGNED' });

  // Kết quả kiểm tra vị trí (không coi GPS là bằng chứng tuyệt đối).
  let result: 'ok' | 'outside_radius' | 'no_location' = 'ok'; let dist: number | null = null;
  const g = campus.geofence as { lat: number; lng: number; radiusM?: number } | undefined;
  if (!location) result = 'no_location';
  else if (g && typeof g.lat === 'number') {
    dist = Math.round(distanceM(location.lat, location.lng, g.lat, g.lng));
    if (dist - (location.accuracy ?? 0) > (g.radiusM ?? 150)) result = 'outside_radius';
  }
  if (source === 'device') result = 'ok';

  const skewMin = Math.round((deviceTime.getTime() - serverNow.getTime()) / 60000);
  const effective = source === 'device' || Math.abs(skewMin) <= 10 ? deviceTime : serverNow;
  const dayKey = dayKeyOf(effective, tz);

  // Thứ tự vào/ra: lượt gốc gần nhất (không tính điều chỉnh).
  const recent = asDocs(await ctx.col('punches').where('employeeId', '==', employeeId).where('dayKey', 'in', [addDays(today, -1), today, addDays(today, 1)]).get())
    .filter((x) => x.id !== opId)
    .sort((a, b) => (toDate(a.effectiveTime)?.getTime() ?? 0) - (toDate(b.effectiveTime)?.getTime() ?? 0));
  const last = recent[recent.length - 1];
  const lastAgeH = last ? (effective.getTime() - (toDate(last.effectiveTime)?.getTime() ?? 0)) / 3_600_000 : Infinity;
  const openIn = last && last.kind === 'in' && lastAgeH < 20;
  if (kind === 'in' && openIn) fail('PRECONDITION', 'Bạn đã chấm vào mà chưa chấm ra. Hãy chấm ra hoặc gửi đề nghị bổ sung.', { reason: 'PUNCH_ORDER' });
  if (kind === 'out' && !openIn) fail('PRECONDITION', 'Chưa có lượt vào để chấm ra. Hãy chấm vào hoặc gửi đề nghị bổ sung.', { reason: 'PUNCH_ORDER' });

  // Ca dự kiến gần nhất với thời điểm chấm.
  let expectedShift: Record<string, unknown> | null = null;
  const es = asDocs(await ctx.col('rosterEntries').where('employeeId', '==', employeeId).where('dayKey', 'in', [addDays(dayKey, -1), dayKey]).get())
    .filter((e) => e.status !== 'superseded' && !e.actualEmployeeId);
  const swapped = asDocs(await ctx.col('rosterEntries').where('actualEmployeeId', '==', employeeId).where('dayKey', 'in', [addDays(dayKey, -1), dayKey]).get());
  let bestGap = Infinity;
  for (const e of [...es, ...swapped]) {
    const w = shiftWindow(e.shiftSnapshot);
    const m = minutesSinceDayStart(e.dayKey, effective, tz);
    const gap = m < w.start ? w.start - m : m > w.end ? m - w.end : 0;
    if (gap < bestGap && gap <= 360) { bestGap = gap; expectedShift = { entryId: e.id, shiftId: e.shiftId, dayKey: e.dayKey, campusId: e.campusId, start: e.shiftSnapshot.startTime, end: e.shiftSnapshot.endTime }; }
  }

  const doc = {
    employeeId, campusId, kind, source, deviceTime: ts(deviceTime), serverTime: ts(serverNow), effectiveTime: ts(effective), dayKey,
    clockSkewMinutes: skewMin, location, distanceM: dist, result, expectedShift, syncStatus: 'synced', immutable: true,
    recordedBy: ctx.uid, note: typeof p?.note === 'string' ? p.note.slice(0, 300) : null,
  };
  try {
    await ctx.doc(`punches/${opId}`).create({ ...doc, ...ctx.metaCreate() });
  } catch (e: any) {
    if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) {
      const s = await ctx.doc(`punches/${opId}`).get(); // gửi trùng: trả đúng lượt đã ghi
      return { id: opId, duplicate: true, result: s.data()?.result, serverTime: s.data()?.serverTime, dayKey: s.data()?.dayKey };
    }
    throw e;
  }
  if (source !== 'app' || result === 'outside_radius') await ctx.audit({ action: `punch.${source}`, collection: 'punches', docId: opId, campusId, after: { employeeId, kind, result } });
  return { id: opId, result, serverTime: serverNow.toISOString(), dayKey, expectedShift, hhmm: hhmmOf(effective, tz) };
};

// ---------------------------------------------------------------- punchAdjust
const punchAdjustRequest = async (ctx: Ctx, p: any) => {
  const dayKey = needDay(p?.dayKey, 'dayKey');
  const kind = p?.kind; if (kind !== 'in' && kind !== 'out') invalid({ kind: 'Loại lượt chấm phải là in hoặc out.' });
  const reason = needStr(p?.reason, 'reason', 500);
  if (reason.length < 5) invalid({ reason: 'Nêu lý do cụ thể (tối thiểu 5 ký tự).' });
  const own = ctx.member?.employeeId;
  const employeeId = typeof p?.employeeId === 'string' ? p.employeeId : employeeIdOf(ctx);
  const emp = await getEmployee(ctx, employeeId);
  const campusId = (p?.campusId as string) || emp.campusId;
  const campus = await getCampus(ctx, campusId);
  if (employeeId !== own) ctx.require('timekeeping.approve', campusId);
  else if (!(await assignedAt(ctx, emp, campusId, dayKey))) fail('PRECONDITION', 'Bạn không được phân công tại cơ sở này vào ngày đó.');
  const tz = tzOf(campus);
  if (dayKey > dayKeyOf(ctx.now, tz)) invalid({ dayKey: 'Không thể điều chỉnh cho ngày trong tương lai.' });
  if (await isPeriodLocked(ctx, campusId, dayKey)) fail('PRECONDITION', `Kỳ công ${dayKey.slice(0, 7)} đã khóa. Nhân sự cần mở lại kỳ hoặc chuyển sang kỳ điều chỉnh.`, { reason: 'PERIOD_LOCKED' });
  let requestedTime: Date | null;
  if (typeof p?.requestedTime === 'string' && /^\d{2}:\d{2}$/.test(p.requestedTime)) {
    requestedTime = zonedTimeToDate(p.nextDay === true ? addDays(dayKey, 1) : dayKey, p.requestedTime, tz);
  } else requestedTime = toDate(p?.requestedTime);
  if (!requestedTime) invalid({ requestedTime: 'Thời gian đề nghị không hợp lệ (HH:mm hoặc ISO).' });
  const dup = asDocs(await ctx.col('punchAdjustments').where('employeeId', '==', employeeId).where('status', '==', 'pending').get()).find((a) => a.dayKey === dayKey && a.kind === kind);
  if (dup) fail('CONFLICT', 'Đã có đề nghị bổ sung đang chờ duyệt cho lượt này.', { existingId: dup.id });
  const originals = asDocs(await ctx.col('punches').where('employeeId', '==', employeeId).where('dayKey', '==', dayKey).get()).filter((x) => x.kind === kind);
  const id = await createDoc(ctx, 'punchAdjustments', undefined, {
    employeeId, employeeName: emp.fullName, campusId, dayKey, kind, requestedTime: ts(requestedTime), reason,
    evidencePaths: Array.isArray(p?.evidencePaths) ? p.evidencePaths.slice(0, 10) : [], originalPunchIds: originals.map((o) => o.id), status: 'pending',
  });
  const approvalId = await createApproval(ctx, {
    type: 'punch_adjust', campusId, refCollection: 'punchAdjustments', refId: id,
    summary: `${emp.fullName}: bổ sung lượt ${kind === 'in' ? 'vào' : 'ra'} ngày ${dayKey}`,
    impact: { employeeId, dayKey, kind, originalPunches: originals.length, requestedAt: requestedTime.toISOString() },
  });
  await ctx.doc(`punchAdjustments/${id}`).update({ approvalId });
  return { id, approvalId, status: 'pending' };
};

async function decidePunchAdjust(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined, viaApproval: boolean) {
  const a = await getInCampus(ctx, 'punchAdjustments', id, null, 'Đề nghị điều chỉnh');
  ctx.require('timekeeping.approve', a.campusId);
  if (a.status !== 'pending') fail('INVALID_STATE', 'Đề nghị này đã được xử lý.');
  separateDuties(ctx, a.createdBy, 'đề nghị bổ sung công');
  if (decision === 'approved' && (await isPeriodLocked(ctx, a.campusId, a.dayKey))) fail('PRECONDITION', 'Kỳ công đã khóa. Mở lại kỳ có kiểm soát hoặc chuyển sang kỳ điều chỉnh.', { reason: 'PERIOD_LOCKED' });
  // Lượt gốc KHÔNG bị xóa/ghi đè: bản điều chỉnh liên kết (originalPunchIds) được dùng khi tính công.
  await updateDoc(ctx, ctx.doc(`punchAdjustments/${id}`), {
    status: decision, decidedBy: ctx.uid, decidedAt: Timestamp.now(), decisionNote: note ?? null,
    ...(decision === 'approved' ? { effectiveTime: a.requestedTime, adjustsPunchIds: a.originalPunchIds ?? [] } : {}),
  });
  if (!viaApproval) await syncApproval(ctx, 'punchAdjustments', id, decision, note);
  await ctx.audit({ action: `punchAdjust.${decision}`, collection: 'punchAdjustments', docId: id, campusId: a.campusId, reason: note, after: { employeeId: a.employeeId, dayKey: a.dayKey, kind: a.kind } });
  await notifyEmployee(ctx, a.employeeId, a.campusId, 'Điều chỉnh chấm công', `Đề nghị bổ sung công ngày ${a.dayKey}: ${decision === 'approved' ? 'đã duyệt' : 'bị từ chối'}.`, { c: 'punchAdjustments', id });
  return { id, status: decision };
}

registerApprovalHandler('punch_adjust', {
  perm: 'timekeeping.approve',
  onApprove: (ctx, a: ApprovalDoc, note) => decidePunchAdjust(ctx, a.refId!, 'approved', note, true),
  onReject: (ctx, a: ApprovalDoc, note) => decidePunchAdjust(ctx, a.refId!, 'rejected', note, true),
});

// ---------------------------------------------------------------- staffLeave
const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'maternity', 'wedding', 'bereavement', 'other'] as const;
const PAID_LEAVE = new Set(['annual', 'sick', 'maternity', 'wedding', 'bereavement']);

async function leaveBalance(ctx: Ctx, emp: Doc, year: string, excludeId?: string) {
  const entitlement = (emp.annualLeaveDays as number | undefined) ?? 12;
  const ls = asDocs(await ctx.col('staffLeaves').where('employeeId', '==', emp.id).get())
    .filter((l) => l.type === 'annual' && ['approved', 'pending'].includes(l.status) && String(l.fromDay).startsWith(year) && l.id !== excludeId);
  const used = ls.reduce((s, l) => s + (l.days ?? 0), 0);
  return { entitlement, used, remaining: entitlement - used };
}

async function leaveWarnings(ctx: Ctx, campusId: string, campus: Doc, emp: Doc, from: string, to: string) {
  const es = asDocs(await ctx.col('rosterEntries').where('campusId', '==', campusId).where('dayKey', '>=', from).where('dayKey', '<=', to).get()).filter((e) => e.status !== 'superseded');
  const mine = es.filter((e) => (e.actualEmployeeId ?? e.employeeId) === emp.id);
  // Mô phỏng: bỏ ca của người xin nghỉ và của những người đã nghỉ phép được duyệt.
  const rest = es.filter((e) => (e.actualEmployeeId ?? e.employeeId) !== emp.id && e.status !== 'on_leave').map((e) => ({ employeeId: (e.actualEmployeeId ?? e.employeeId) as string, dayKey: e.dayKey as string }));
  // chỉ xét các ngày người này có ca
  const days = new Set(mine.map((e) => e.dayKey as string));
  const entries = [...rest.filter((e) => days.has(e.dayKey)), ...[...days].map((d) => ({ employeeId: '__marker__', dayKey: d }))];
  const shortage = (await computeShortages(ctx, campusId, entries, campus)).filter((s) => days.has(s.dayKey));
  return { affectedShifts: mine.map((e) => ({ entryId: e.id, dayKey: e.dayKey, shiftId: e.shiftId })), shortage };
}

const staffLeaveRequest = async (ctx: Ctx, p: any) => {
  const d = validate<any>(p, { type: { t: 'string', req: true, oneOf: LEAVE_TYPES }, fromDay: { t: 'day', req: true }, toDay: { t: 'day', req: true }, reason: { t: 'string', req: true, min: 3, max: 500 }, handoverTo: { t: 'string', max: 128 } });
  requireRange(d.fromDay, d.toDay);
  if (dayIndex(d.toDay) - dayIndex(d.fromDay) > 120) invalid({ toDay: 'Khoảng nghỉ tối đa 120 ngày.' });
  const own = ctx.member?.employeeId;
  const employeeId = typeof p?.employeeId === 'string' ? p.employeeId : employeeIdOf(ctx);
  const emp = await getEmployee(ctx, employeeId);
  const campusId = (p?.campusId as string) || emp.campusId;
  const campus = await getCampus(ctx, campusId);
  if (employeeId !== own) ctx.require('leave_staff.decide', campusId); // ghi nhận hộ (nghỉ đột xuất)
  else if (!(await assignedAt(ctx, emp, campusId, d.fromDay)) && emp.campusId !== campusId) fail('PRECONDITION', 'Bạn không thuộc cơ sở này.');
  if (d.handoverTo) { const h = await getEmployee(ctx, d.handoverTo); if (h.id === emp.id) invalid({ handoverTo: 'Người bàn giao phải khác bạn.' }); }
  const clash = asDocs(await ctx.col('staffLeaves').where('employeeId', '==', employeeId).get())
    .find((l) => ['pending', 'approved'].includes(l.status) && l.fromDay <= d.toDay && l.toDay >= d.fromDay);
  if (clash) fail('CONFLICT', 'Đã có đơn nghỉ trùng thời gian này.', { conflictId: clash.id });
  const { days } = await countWorkDays(ctx, employeeId, d.fromDay, d.toDay);
  const paid = PAID_LEAVE.has(d.type);
  let balance: unknown = null;
  if (d.type === 'annual') {
    const b = await leaveBalance(ctx, emp, d.fromDay.slice(0, 4));
    balance = b;
    if (days > b.remaining) fail('LIMIT', `Số dư phép năm không đủ: còn ${b.remaining} ngày, đề nghị ${days} ngày.`, { balance: b });
  }
  const warn = await leaveWarnings(ctx, campusId, campus, emp, d.fromDay, d.toDay);
  const today = dayKeyOf(ctx.now, tzOf(campus));
  const id = await createDoc(ctx, 'staffLeaves', undefined, {
    ...d, employeeId, employeeName: emp.fullName, campusId, days, paid, status: 'pending', warnings: warn, retroactive: d.fromDay < today, balance,
  });
  const approvalId = await createApproval(ctx, {
    type: 'staff_leave', campusId, refCollection: 'staffLeaves', refId: id,
    summary: `${emp.fullName} xin nghỉ ${d.type} ${d.fromDay} → ${d.toDay} (${days} ngày)`,
    impact: { days, balance, affectedShifts: warn.affectedShifts.length, teacherShortage: warn.shortage.length },
  });
  await ctx.doc(`staffLeaves/${id}`).update({ approvalId });
  return { id, approvalId, days, balance, warnings: warn, status: 'pending' };
};

async function decideStaffLeave(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined, viaApproval: boolean) {
  const l = await getInCampus(ctx, 'staffLeaves', id, null, 'Đơn nghỉ');
  ctx.require('leave_staff.decide', l.campusId);
  if (l.status !== 'pending') fail('INVALID_STATE', 'Đơn nghỉ này đã được xử lý.');
  separateDuties(ctx, l.createdBy, 'đơn nghỉ');
  const emp = await getEmployee(ctx, l.employeeId);
  let warnings = l.warnings;
  if (decision === 'approved') {
    for (const dk of [l.fromDay, l.toDay]) if (await isPeriodLocked(ctx, l.campusId, dk)) fail('PRECONDITION', 'Kỳ công liên quan đã khóa; mở lại kỳ trước khi duyệt nghỉ.', { reason: 'PERIOD_LOCKED' });
    if (l.type === 'annual') {
      const b = await leaveBalance(ctx, emp, String(l.fromDay).slice(0, 4), id);
      if (l.days > b.remaining) fail('LIMIT', `Số dư phép năm không đủ: còn ${b.remaining} ngày.`, { balance: b });
    }
    const campus = await getCampus(ctx, l.campusId);
    warnings = await leaveWarnings(ctx, l.campusId, campus, emp, l.fromDay, l.toDay); // cảnh báo thiếu GV: quản lý đã nhìn thấy khi duyệt
  }
  await updateDoc(ctx, ctx.doc(`staffLeaves/${id}`), { status: decision, decidedBy: ctx.uid, decidedAt: Timestamp.now(), decisionNote: note ?? null, warnings });
  if (decision === 'approved') {
    // Cập nhật lịch: ca của ngày nghỉ gắn leaveId (tính công sẽ lấy phép có/không lương).
    const es = asDocs(await ctx.col('rosterEntries').where('employeeId', '==', l.employeeId).where('dayKey', '>=', l.fromDay).where('dayKey', '<=', l.toDay).get()).filter((e) => e.status !== 'superseded');
    await commitOps(es.map((e) => (b) => b.update(ctx.doc(`rosterEntries/${e.id}`), { status: 'on_leave', leaveId: id, updatedAt: Timestamp.now(), updatedBy: ctx.uid, version: (e.version ?? 0) + 1 })));
  }
  if (!viaApproval) await syncApproval(ctx, 'staffLeaves', id, decision, note);
  await ctx.audit({ action: `staffLeave.${decision}`, collection: 'staffLeaves', docId: id, campusId: l.campusId, reason: note, after: { employeeId: l.employeeId, fromDay: l.fromDay, toDay: l.toDay, days: l.days } });
  await notifyEmployee(ctx, l.employeeId, l.campusId, 'Đơn nghỉ phép', `Đơn nghỉ ${l.fromDay} → ${l.toDay}: ${decision === 'approved' ? 'đã duyệt' : 'bị từ chối'}.`, { c: 'staffLeaves', id });
  return { id, status: decision, warnings };
}

registerApprovalHandler('staff_leave', {
  perm: 'leave_staff.decide',
  onApprove: (ctx, a, note) => decideStaffLeave(ctx, a.refId!, 'approved', note, true),
  onReject: (ctx, a, note) => decideStaffLeave(ctx, a.refId!, 'rejected', note, true),
});

// ---------------------------------------------------------------- shiftSwap
const shiftSwapRequest = async (ctx: Ctx, p: any) => {
  const entry = await getInCampus(ctx, 'rosterEntries', p?.entryId, null, 'Ca làm');
  const me = employeeIdOf(ctx);
  if ((entry.actualEmployeeId ?? entry.employeeId) !== me) fail('PERMISSION_DENIED', 'Đây không phải ca của bạn.');
  if (entry.status === 'superseded' || entry.status === 'on_leave') fail('INVALID_STATE', 'Ca này không còn hiệu lực để đổi.');
  const toId = needStr(p?.toEmployeeId, 'toEmployeeId');
  if (toId === me) invalid({ toEmployeeId: 'Người nhận ca phải khác bạn.' });
  const to = await getEmployee(ctx, toId);
  const campus = await getCampus(ctx, entry.campusId);
  assertFuture(ctx, entry.dayKey, dayKeyOf(ctx.now, tzOf(campus)));
  if (!(await assignedAt(ctx, to, entry.campusId, entry.dayKey))) fail('PRECONDITION', `${to.fullName} chưa được phân công tại cơ sở này.`);
  await assertNoOverlap(ctx, toId, entry);
  const open = asDocs(await ctx.col('shiftSwaps').where('entryId', '==', entry.id).get()).find((s) => ['awaiting_peer', 'awaiting_manager'].includes(s.status));
  if (open) fail('CONFLICT', 'Ca này đang có yêu cầu đổi chưa hoàn tất.');
  const from = await getEmployee(ctx, me);
  const id = await createDoc(ctx, 'shiftSwaps', undefined, {
    campusId: entry.campusId, entryId: entry.id, dayKey: entry.dayKey, shiftId: entry.shiftId, fromEmployeeId: me, fromName: from.fullName,
    toEmployeeId: toId, toName: to.fullName, reason: typeof p?.reason === 'string' ? p.reason.slice(0, 500) : '', status: 'awaiting_peer',
  });
  await notifyEmployee(ctx, toId, entry.campusId, 'Đề nghị đổi ca', `${from.fullName} đề nghị đổi ca ngày ${entry.dayKey} cho bạn.`, { c: 'shiftSwaps', id });
  return { id, status: 'awaiting_peer' };
};

function assertFuture(_ctx: Ctx, day: string, today: string) {
  if (day < today) fail('PRECONDITION', 'Không đổi ca của ngày đã qua (không sửa ca quá khứ để che đi muộn).', { reason: 'PAST_DAY' });
}

async function assertNoOverlap(ctx: Ctx, employeeId: string, entry: Doc) {
  const w = shiftWindow(entry.shiftSnapshot);
  const a1 = dayIndex(entry.dayKey) * 1440 + w.start; const a2 = dayIndex(entry.dayKey) * 1440 + w.end;
  const others = [
    ...asDocs(await ctx.col('rosterEntries').where('employeeId', '==', employeeId).where('dayKey', 'in', [addDays(entry.dayKey, -1), entry.dayKey, addDays(entry.dayKey, 1)]).get()).filter((o) => !o.actualEmployeeId),
    ...asDocs(await ctx.col('rosterEntries').where('actualEmployeeId', '==', employeeId).where('dayKey', 'in', [addDays(entry.dayKey, -1), entry.dayKey, addDays(entry.dayKey, 1)]).get()),
  ].filter((o) => o.id !== entry.id && o.status !== 'superseded');
  for (const o of others) {
    const ow = shiftWindow(o.shiftSnapshot);
    if (overlaps(a1, a2, dayIndex(o.dayKey) * 1440 + ow.start, dayIndex(o.dayKey) * 1440 + ow.end)) fail('PRECONDITION', 'Người nhận đã có ca trùng thời gian với ca này.', { reason: 'SHIFT_OVERLAP', conflictEntry: o.id });
  }
}

const shiftSwapRespond = async (ctx: Ctx, p: any) => {
  const sw = await getInCampus(ctx, 'shiftSwaps', p?.id, null, 'Yêu cầu đổi ca');
  if (sw.toEmployeeId !== ctx.member?.employeeId) fail('PERMISSION_DENIED', 'Chỉ người được đề nghị nhận ca mới trả lời.');
  if (sw.status !== 'awaiting_peer') fail('INVALID_STATE', 'Yêu cầu đã được trả lời.');
  const accept = p?.accept === true;
  if (!accept) {
    await updateDoc(ctx, ctx.doc(`shiftSwaps/${sw.id}`), { status: 'declined_by_peer', peerRespondedAt: Timestamp.now(), peerNote: p?.note ?? null });
    await notifyEmployee(ctx, sw.fromEmployeeId, sw.campusId, 'Đổi ca', `${sw.toName} đã từ chối nhận ca ngày ${sw.dayKey}.`, { c: 'shiftSwaps', id: sw.id });
    return { id: sw.id, status: 'declined_by_peer' };
  }
  const entry = await getInCampus(ctx, 'rosterEntries', sw.entryId, null, 'Ca làm');
  await assertNoOverlap(ctx, sw.toEmployeeId, entry);
  const approvalId = await createApproval(ctx, {
    type: 'shift_swap', campusId: sw.campusId, refCollection: 'shiftSwaps', refId: sw.id,
    summary: `Đổi ca ${sw.dayKey}: ${sw.fromName} → ${sw.toName}`, impact: { dayKey: sw.dayKey, shiftId: sw.shiftId, from: sw.fromEmployeeId, to: sw.toEmployeeId },
  });
  await updateDoc(ctx, ctx.doc(`shiftSwaps/${sw.id}`), { status: 'awaiting_manager', peerRespondedAt: Timestamp.now(), peerNote: p?.note ?? null, approvalId });
  return { id: sw.id, status: 'awaiting_manager', approvalId };
};

async function decideShiftSwap(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined, viaApproval: boolean) {
  const sw = await getInCampus(ctx, 'shiftSwaps', id, null, 'Yêu cầu đổi ca');
  ctx.require('leave_staff.decide', sw.campusId);
  if (sw.status !== 'awaiting_manager') fail('INVALID_STATE', sw.status === 'awaiting_peer' ? 'Người nhận ca chưa đồng ý.' : 'Yêu cầu đã được xử lý.');
  if (decision === 'approved') {
    const entry = await getInCampus(ctx, 'rosterEntries', sw.entryId, null, 'Ca làm');
    const campus = await getCampus(ctx, sw.campusId);
    assertFuture(ctx, entry.dayKey, dayKeyOf(ctx.now, tzOf(campus)));
    if (await isPeriodLocked(ctx, sw.campusId, entry.dayKey)) fail('PRECONDITION', 'Kỳ công đã khóa.', { reason: 'PERIOD_LOCKED' });
    await assertNoOverlap(ctx, sw.toEmployeeId, entry);
    // Lưu người làm THỰC TẾ; employeeId gốc giữ nguyên để truy vết.
    await updateDoc(ctx, ctx.doc(`rosterEntries/${entry.id}`), { actualEmployeeId: sw.toEmployeeId, swapId: sw.id });
  }
  await updateDoc(ctx, ctx.doc(`shiftSwaps/${id}`), { status: decision, decidedBy: ctx.uid, decidedAt: Timestamp.now(), decisionNote: note ?? null });
  if (!viaApproval) await syncApproval(ctx, 'shiftSwaps', id, decision, note);
  await ctx.audit({ action: `shiftSwap.${decision}`, collection: 'shiftSwaps', docId: id, campusId: sw.campusId, reason: note, after: { entryId: sw.entryId, to: sw.toEmployeeId } });
  for (const e of [sw.fromEmployeeId, sw.toEmployeeId]) await notifyEmployee(ctx, e, sw.campusId, 'Đổi ca', `Đổi ca ngày ${sw.dayKey}: ${decision === 'approved' ? 'đã duyệt' : 'bị từ chối'}.`, { c: 'shiftSwaps', id });
  return { id, status: decision };
}

registerApprovalHandler('shift_swap', {
  perm: 'leave_staff.decide',
  onApprove: (ctx, a, note) => decideShiftSwap(ctx, a.refId!, 'approved', note, true),
  onReject: (ctx, a, note) => decideShiftSwap(ctx, a.refId!, 'rejected', note, true),
});

// ---------------------------------------------------------------- overtime
const overtimeRequest = async (ctx: Ctx, p: any) => {
  const dayKey = needDay(p?.dayKey, 'dayKey');
  const d = validate<any>(p, { minutes: { t: 'int', req: true, min: 15, max: 720 }, reason: { t: 'string', req: true, min: 3, max: 500 } });
  const own = ctx.member?.employeeId;
  const employeeId = typeof p?.employeeId === 'string' ? p.employeeId : employeeIdOf(ctx);
  const emp = await getEmployee(ctx, employeeId);
  const campusId = (p?.campusId as string) || emp.campusId;
  await getCampus(ctx, campusId);
  if (employeeId !== own) ctx.require('timekeeping.approve', campusId);
  else if (!(await assignedAt(ctx, emp, campusId, dayKey))) fail('PRECONDITION', 'Bạn không được phân công tại cơ sở này vào ngày đó.');
  if (await isPeriodLocked(ctx, campusId, dayKey)) fail('PRECONDITION', 'Kỳ công đã khóa.', { reason: 'PERIOD_LOCKED' });
  const dup = asDocs(await ctx.col('overtimeRequests').where('employeeId', '==', employeeId).where('dayKey', '==', dayKey).get()).find((o) => ['pending', 'approved'].includes(o.status));
  if (dup) fail('CONFLICT', 'Đã có đề nghị tăng ca cho ngày này.', { existingId: dup.id });
  const id = await createDoc(ctx, 'overtimeRequests', undefined, { ...d, employeeId, employeeName: emp.fullName, campusId, dayKey, status: 'pending', approvedMinutes: 0 });
  const approvalId = await createApproval(ctx, {
    type: 'overtime', campusId, refCollection: 'overtimeRequests', refId: id,
    summary: `${emp.fullName} đề nghị tăng ca ${d.minutes} phút ngày ${dayKey}`, impact: { minutes: d.minutes, dayKey },
  });
  await ctx.doc(`overtimeRequests/${id}`).update({ approvalId });
  return { id, approvalId, status: 'pending' };
};

async function decideOvertime(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined, approvedMinutes: number | undefined, viaApproval: boolean) {
  const o = await getInCampus(ctx, 'overtimeRequests', id, null, 'Đề nghị tăng ca');
  ctx.require('timekeeping.approve', o.campusId);
  if (o.status !== 'pending') fail('INVALID_STATE', 'Đề nghị tăng ca đã được xử lý.');
  separateDuties(ctx, o.createdBy, 'đề nghị tăng ca');
  if (decision === 'approved' && (await isPeriodLocked(ctx, o.campusId, o.dayKey))) fail('PRECONDITION', 'Kỳ công đã khóa.', { reason: 'PERIOD_LOCKED' });
  const am = decision === 'approved' ? Math.min(o.minutes, approvedMinutes ?? o.minutes) : 0;
  if (decision === 'approved' && (!Number.isInteger(am) || am <= 0)) invalid({ approvedMinutes: 'Số phút duyệt phải là số nguyên dương.' });
  await updateDoc(ctx, ctx.doc(`overtimeRequests/${id}`), { status: decision, approvedMinutes: am, decidedBy: ctx.uid, decidedAt: Timestamp.now(), decisionNote: note ?? null });
  if (!viaApproval) await syncApproval(ctx, 'overtimeRequests', id, decision, note);
  await ctx.audit({ action: `overtime.${decision}`, collection: 'overtimeRequests', docId: id, campusId: o.campusId, reason: note, after: { approvedMinutes: am } });
  return { id, status: decision, approvedMinutes: am };
}

registerApprovalHandler('overtime', {
  perm: 'timekeeping.approve',
  onApprove: (ctx, a, note) => decideOvertime(ctx, a.refId!, 'approved', note, undefined, true),
  onReject: (ctx, a, note) => decideOvertime(ctx, a.refId!, 'rejected', note, undefined, true),
});

// ---------------------------------------------------------------- actions
export const actions: ActionMap = {
  'employee.save': { scope: 'org', perm: 'staff.write', handler: employeeSave },
  'employee.assign': { scope: 'org', perm: 'staff.write', handler: employeeAssign },
  'roster.publish': { scope: 'org', perm: 'roster.write', handler: rosterPublish },
  'punch.record': { scope: 'org', idempotent: true, handler: punchRecord },
  'punchAdjust.request': { scope: 'org', handler: punchAdjustRequest },
  'punchAdjust.decide': {
    scope: 'org', handler: (ctx, p: any) => decidePunchAdjust(ctx, p?.id, needDecision(p?.decision), p?.note, false),
  },
  'staffLeave.request': { scope: 'org', handler: staffLeaveRequest },
  'staffLeave.decide': { scope: 'org', handler: (ctx, p: any) => decideStaffLeave(ctx, p?.id, needDecision(p?.decision), p?.note, false) },
  'shiftSwap.request': { scope: 'org', handler: shiftSwapRequest },
  'shiftSwap.respond': { scope: 'org', handler: shiftSwapRespond },
  'shiftSwap.decide': { scope: 'org', handler: (ctx, p: any) => decideShiftSwap(ctx, p?.id, needDecision(p?.decision), p?.note, false) },
  'overtime.request': { scope: 'org', handler: overtimeRequest },
  'overtime.decide': { scope: 'org', handler: (ctx, p: any) => decideOvertime(ctx, p?.id, needDecision(p?.decision), p?.note, p?.approvedMinutes, false) },
  ...timesheetActions,
};

export { periodRange };
