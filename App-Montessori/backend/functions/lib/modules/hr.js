"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.periodRange = exports.actions = void 0;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const entity_registry_1 = require("../core/entity-registry");
const approvals_1 = require("../core/approvals");
const validate_1 = require("../core/validate");
const common_1 = require("../lib/common");
const hr_common_1 = require("../lib/hr-common");
const time_1 = require("../lib/time");
Object.defineProperty(exports, "periodRange", { enumerable: true, get: function () { return time_1.periodRange; } });
const hr_timesheet_1 = require("./hr-timesheet");
// ---------------------------------------------------------------- Entity: shifts, rosters
(0, entity_registry_1.registerEntity)('shifts', {
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
        if (data.startTime && data.endTime && data.startTime === data.endTime)
            (0, errors_1.invalid)({ endTime: 'Giờ kết thúc phải khác giờ bắt đầu.' });
        const end = data.endTime;
        const start = data.startTime;
        return { ...(start && end ? { overnight: end <= start } : {}), breakMinutes: data.breakMinutes ?? 0 };
    },
});
(0, entity_registry_1.registerEntity)('rosters', {
    writePerm: 'roster.write', campusScoped: true, idPrefix: 'ros_',
    schema: {
        fromDay: { t: 'day', req: true }, toDay: { t: 'day', req: true }, note: { t: 'string', max: 500 },
        status: { t: 'string', oneOf: ['draft'] },
    },
    async beforeSave(_ctx, data) { (0, validate_1.requireRange)(data.fromDay, data.toDay, 'fromDay', 'toDay'); return { status: 'draft' }; },
    editableStatuses: ['draft'],
});
// ---------------------------------------------------------------- employee.save / employee.assign
const EMP_SCHEMA = {
    code: { t: 'string', req: true, min: 1, max: 30 }, fullName: { t: 'string', req: true, min: 2, max: 150 },
    phone: { t: 'string', max: 20 }, email: { t: 'string', max: 150 }, title: { t: 'string', max: 100 },
    status: { t: 'string', oneOf: ['active', 'on_leave', 'resigned'] },
    startDate: { t: 'day' }, endDate: { t: 'day' }, dob: { t: 'day' },
    gender: { t: 'string', oneOf: ['male', 'female', 'other'] },
    annualLeaveDays: { t: 'int', min: 0, max: 60 }, note: { t: 'string', max: 1000 },
};
const CONTRACT_SCHEMA = {
    type: { t: 'string', req: true, oneOf: ['probation', 'fixed_term', 'indefinite', 'part_time', 'service'] },
    startDate: { t: 'day', req: true }, endDate: { t: 'day' }, position: { t: 'string', max: 100 },
    standardDays: { t: 'number', min: 1, max: 31 }, status: { t: 'string', oneOf: ['active', 'ended', 'cancelled'] },
    note: { t: 'string', max: 500 },
};
const employeeSave = async (ctx, p) => {
    const campusId = p?.campusId || ctx.campusId;
    if (!campusId)
        (0, errors_1.invalid)({ campusId: 'Bắt buộc chọn cơ sở chính.' });
    await (0, store_1.getCampus)(ctx, campusId);
    ctx.require('staff.write', campusId);
    const data = (0, validate_1.validate)(p, EMP_SCHEMA, { partial: !!p?.id });
    if (data.startDate && data.endDate && data.startDate > data.endDate)
        (0, errors_1.invalid)({ endDate: 'Ngày nghỉ việc phải sau ngày vào làm.' });
    const id = p?.id;
    let existing = null;
    if (id) {
        existing = await (0, common_1.getInCampus)(ctx, 'employees', id, null, 'Nhân viên');
        ctx.require('staff.write', existing.campusId); // không tin client: quyền theo cơ sở của hồ sơ hiện có
    }
    if (data.code) {
        const dup = (0, common_1.asDocs)(await ctx.col('employees').where('code', '==', data.code).get()).find((d) => d.id !== id);
        if (dup)
            (0, errors_1.invalid)({ code: 'Mã nhân viên đã tồn tại.' });
    }
    // hợp đồng: không chồng lấn hiệu lực
    const contracts = Array.isArray(p?.contracts) ? p.contracts : [];
    const cleaned = contracts.map((c, i) => {
        let v;
        try {
            v = (0, validate_1.validate)(c, CONTRACT_SCHEMA);
        }
        catch (e) {
            (0, errors_1.invalid)({ [`contracts[${i}]`]: JSON.stringify(e?.details?.fieldErrors ?? {}) });
        }
        if (v.endDate && v.endDate < v.startDate)
            (0, errors_1.invalid)({ [`contracts[${i}].endDate`]: 'Ngày kết thúc hợp đồng phải sau ngày bắt đầu.' });
        return { id: typeof c.id === 'string' ? c.id : undefined, ...v, status: v.status ?? 'active' };
    });
    const live = cleaned.filter((c) => c.status === 'active');
    for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++) {
            const a = live[i];
            const b = live[j];
            if ((!a.endDate || a.endDate >= b.startDate) && (!b.endDate || b.endDate >= a.startDate))
                (0, errors_1.invalid)({ contracts: 'Hai hợp đồng đang hiệu lực không được chồng thời gian.' });
        }
    // liên kết tài khoản
    let linkUid;
    if (typeof p?.uid === 'string' && p.uid && p.uid !== existing?.uid) {
        ctx.require('members.manage', campusId);
        const m = await ctx.doc(`members/${p.uid}`).get();
        if (!m.exists || m.data()?.kind === 'parent')
            (0, errors_1.invalid)({ uid: 'Tài khoản không phải nhân viên của tổ chức này.' });
        const other = m.data()?.employeeId;
        if (other && other !== id)
            (0, errors_1.fail)('CONFLICT', 'Tài khoản đã liên kết với nhân viên khác.');
        linkUid = p.uid;
    }
    let empId = id;
    let before = null;
    if (existing) {
        const { before: b } = await (0, store_1.updateDoc)(ctx, ctx.doc(`employees/${id}`), { ...data, ...(linkUid ? { uid: linkUid } : {}) }, p.expectedVersion);
        before = b;
    }
    else {
        empId = await (0, store_1.createDoc)(ctx, 'employees', undefined, {
            status: 'active', ...data, campusId, campusIds: [campusId], archived: false, ...(linkUid ? { uid: linkUid } : {}),
        });
    }
    if (linkUid)
        await ctx.doc(`members/${linkUid}`).update({ employeeId: empId, updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid });
    const contractIds = [];
    for (const c of cleaned) {
        const { id: cid, ...rest } = c;
        if (cid) {
            const cur = await (0, common_1.getInCampus)(ctx, 'contracts', cid, null, 'Hợp đồng');
            if (cur.employeeId !== empId)
                (0, errors_1.fail)('NOT_FOUND', 'Hợp đồng không thuộc nhân viên này.');
            await (0, store_1.updateDoc)(ctx, ctx.doc(`contracts/${cid}`), rest);
            contractIds.push(cid);
        }
        else {
            contractIds.push(await (0, store_1.createDoc)(ctx, 'contracts', undefined, { ...rest, employeeId: empId, campusId: existing?.campusId ?? campusId }));
        }
    }
    // tài khoản ngân hàng: chỉ người có quyền lương/kế toán ghi (không nằm trong doc staff.read)
    if (p?.bank && typeof p.bank === 'object') {
        ctx.require('payroll.write', existing?.campusId ?? campusId);
        const b = (0, validate_1.validate)(p.bank, { bankName: { t: 'string', max: 100 }, accountNo: { t: 'string', max: 40 }, accountName: { t: 'string', max: 100 } });
        await ctx.doc(`employees/${empId}/private/bank`).set({ ...b, updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid }, { merge: true });
    }
    await ctx.audit({ action: existing ? 'employee.update' : 'employee.create', collection: 'employees', docId: empId, campusId: existing?.campusId ?? campusId, before, after: { ...data, contractIds } });
    const cur = await ctx.doc(`employees/${empId}`).get();
    return { id: empId, version: cur.data()?.version, contractIds };
};
const employeeAssign = async (ctx, p) => {
    const { id: campusId } = await (0, common_1.resolveCampus)(ctx, p, 'staff.write');
    const emp = await (0, hr_common_1.getEmployee)(ctx, p?.employeeId);
    const d = (0, validate_1.validate)(p, {
        title: { t: 'string', req: true, max: 100 }, fromDay: { t: 'day', req: true }, toDay: { t: 'day' },
        classId: { t: 'string', max: 128 }, role: { t: 'string', max: 50 }, primary: { t: 'bool' },
    });
    if (d.toDay)
        (0, validate_1.requireRange)(d.fromDay, d.toDay);
    if (d.classId) {
        const cls = await (0, common_1.getInCampus)(ctx, 'classes', d.classId, campusId, 'Lớp');
        if (cls.campusId !== campusId)
            (0, errors_1.fail)('NOT_FOUND', 'Lớp không thuộc cơ sở này.');
    }
    const existing = (0, common_1.asDocs)(await ctx.col('staffAssignments').where('employeeId', '==', emp.id).get()).filter((a) => a.status !== 'cancelled');
    const clash = existing.find((a) => a.campusId === campusId && (a.classId ?? null) === (d.classId ?? null)
        && (!a.toDay || a.toDay >= d.fromDay) && (!d.toDay || d.toDay >= a.fromDay) && a.id !== p.id);
    if (clash)
        (0, errors_1.fail)('CONFLICT', 'Nhân viên đã có đợt phân công trùng thời gian tại cơ sở/lớp này.', { conflictId: clash.id });
    const id = await (0, store_1.createDoc)(ctx, 'staffAssignments', undefined, { ...d, employeeId: emp.id, campusId, status: 'active' });
    // Một người nhiều cơ sở: campusIds = hợp các cơ sở có phân công chưa kết thúc + cơ sở chính.
    const today = (0, store_1.dayKeyOf)(ctx.now);
    const all = [...existing, { campusId, toDay: d.toDay }].filter((a) => !a.toDay || a.toDay >= today);
    const campusIds = [...new Set([emp.campusId, ...all.map((a) => a.campusId)].filter(Boolean))];
    await ctx.doc(`employees/${emp.id}`).update({ campusIds, updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid, version: (emp.version ?? 0) + 1 });
    await ctx.audit({ action: 'employee.assign', collection: 'staffAssignments', docId: id, campusId, after: { employeeId: emp.id, ...d } });
    return { id, campusIds, note: 'Lịch ca của nhân viên làm nhiều cơ sở được kiểm tra không trùng khi công bố lịch (roster.publish).' };
};
const rosterPublish = async (ctx, p) => {
    const { id: campusId, campus } = await (0, common_1.resolveCampus)(ctx, p, 'roster.write');
    const fromDay = (0, common_1.needDay)(p?.fromDay, 'fromDay');
    const toDay = (0, common_1.needDay)(p?.toDay, 'toDay');
    (0, validate_1.requireRange)(fromDay, toDay);
    if ((0, time_1.dayIndex)(toDay) - (0, time_1.dayIndex)(fromDay) > 62)
        (0, errors_1.invalid)({ toDay: 'Một lần công bố tối đa 62 ngày.' });
    const raw = Array.isArray(p?.entries) ? p.entries : [];
    if (raw.length > 6000)
        (0, errors_1.fail)('LIMIT', 'Tối đa 6000 mục lịch một lần công bố.');
    const tz = (0, common_1.tzOf)(campus);
    const today = (0, store_1.dayKeyOf)(ctx.now, tz);
    const shifts = new Map((0, common_1.asDocs)(await ctx.col('shifts').where('campusId', '==', campusId).get()).filter((s) => s.active !== false && !s.archived).map((s) => [s.id, s]));
    const empCache = new Map();
    const errors = [];
    const seen = new Set();
    const entries = [];
    for (let i = 0; i < raw.length; i++) {
        const e = raw[i] ?? {};
        if (typeof e.employeeId !== 'string' || !(0, validate_1.isValidDay)(e.dayKey) || typeof e.shiftId !== 'string') {
            errors.push({ index: i, message: 'Mục lịch thiếu nhân viên, ngày hoặc ca.' });
            continue;
        }
        if (e.dayKey < fromDay || e.dayKey > toDay) {
            errors.push({ index: i, field: 'dayKey', message: `Ngày ${e.dayKey} ngoài khoảng công bố.` });
            continue;
        }
        const sh = shifts.get(e.shiftId);
        if (!sh) {
            errors.push({ index: i, field: 'shiftId', message: 'Ca không tồn tại ở cơ sở này hoặc đã ngừng dùng.' });
            continue;
        }
        const key = `${e.employeeId}_${e.dayKey}_${e.shiftId}`;
        if (seen.has(key)) {
            errors.push({ index: i, message: 'Mục lịch bị lặp.' });
            continue;
        }
        seen.add(key);
        let emp;
        const cached = empCache.get(e.employeeId);
        if (cached)
            emp = cached;
        else {
            const s = await ctx.doc(`employees/${e.employeeId}`).get();
            if (!s.exists) {
                errors.push({ index: i, field: 'employeeId', message: 'Nhân viên không tồn tại.' });
                continue;
            }
            emp = { id: s.id, ...s.data() };
            empCache.set(e.employeeId, emp);
        }
        if (emp.status === 'resigned' || (emp.endDate && emp.endDate < e.dayKey)) {
            errors.push({ index: i, field: 'employeeId', message: `${emp.fullName} đã nghỉ việc trước ngày ${e.dayKey}.` });
            continue;
        }
        if (!(await (0, hr_common_1.assignedAt)(ctx, emp, campusId, e.dayKey))) {
            errors.push({ index: i, field: 'employeeId', message: `${emp.fullName} chưa được phân công tại cơ sở này vào ngày ${e.dayKey}.` });
            continue;
        }
        const snap = (0, hr_common_1.snapshotOfShift)(sh);
        const w = (0, hr_common_1.shiftWindow)(snap);
        entries.push({ ...e, snap, ...w });
    }
    if (errors.length)
        (0, errors_1.fail)('VALIDATION', `Lịch ca có ${errors.length} lỗi. Sửa rồi công bố lại.`, { errors });
    // Kỳ công đã khóa: không đổi lịch (kỳ khóa giữ nguyên ca đã dùng).
    for (const pk of new Set((0, time_1.listDays)(fromDay, toDay).map((d) => d.slice(0, 7)))) {
        if (await (0, hr_common_1.isPeriodLocked)(ctx, campusId, `${pk}-01`))
            (0, errors_1.fail)('PRECONDITION', `Kỳ công ${pk} đã khóa; không thể đổi lịch ca. Hãy mở lại kỳ có kiểm soát.`, { reason: 'PERIOD_LOCKED' });
    }
    // Chồng ca: trong chính lịch này + với lịch đã công bố ở cơ sở KHÁC.
    const overlapsFound = [];
    const byEmp = new Map();
    for (const e of entries)
        (byEmp.get(e.employeeId) ?? byEmp.set(e.employeeId, []).get(e.employeeId)).push(e);
    for (const [emp, list] of byEmp) {
        for (let i = 0; i < list.length; i++)
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i];
                const b = list[j];
                const a1 = (0, time_1.dayIndex)(a.dayKey) * 1440 + a.start;
                const a2 = (0, time_1.dayIndex)(a.dayKey) * 1440 + a.end;
                const b1 = (0, time_1.dayIndex)(b.dayKey) * 1440 + b.start;
                const b2 = (0, time_1.dayIndex)(b.dayKey) * 1440 + b.end;
                if ((0, time_1.overlaps)(a1, a2, b1, b2))
                    overlapsFound.push({ employeeId: emp, dayKey: a.dayKey, with: `${b.shiftId}@${b.dayKey}` });
            }
    }
    const others = (0, common_1.asDocs)(await ctx.col('rosterEntries').where('dayKey', '>=', (0, time_1.addDays)(fromDay, -1)).where('dayKey', '<=', (0, time_1.addDays)(toDay, 1)).get())
        .filter((o) => o.campusId !== campusId && o.status !== 'superseded' && byEmp.has(o.actualEmployeeId ?? o.employeeId));
    for (const o of others) {
        const oe = o.actualEmployeeId ?? o.employeeId;
        const ow = (0, hr_common_1.shiftWindow)(o.shiftSnapshot);
        for (const e of byEmp.get(oe) ?? []) {
            if ((0, time_1.overlaps)((0, time_1.dayIndex)(e.dayKey) * 1440 + e.start, (0, time_1.dayIndex)(e.dayKey) * 1440 + e.end, (0, time_1.dayIndex)(o.dayKey) * 1440 + ow.start, (0, time_1.dayIndex)(o.dayKey) * 1440 + ow.end)) {
                overlapsFound.push({ employeeId: oe, dayKey: e.dayKey, with: `cơ sở ${o.campusId} ${o.dayKey} ${o.shiftSnapshot.startTime}-${o.shiftSnapshot.endTime}` });
            }
        }
    }
    if (overlapsFound.length)
        (0, errors_1.fail)('PRECONDITION', `Có ${overlapsFound.length} ca chồng thời gian; một người ở nhiều cơ sở không được trùng ca.`, { reason: 'SHIFT_OVERLAP', overlaps: overlapsFound.slice(0, 50) });
    // Ngày đã qua: không sửa lịch (không che đi muộn).
    const existing = (0, common_1.asDocs)(await ctx.col('rosterEntries').where('campusId', '==', campusId).where('dayKey', '>=', fromDay).where('dayKey', '<=', toDay).get());
    const existingActive = existing.filter((x) => x.status !== 'superseded');
    const newKeys = new Set(entries.map((e) => `${e.employeeId}_${e.dayKey}_${e.shiftId}`));
    const pastDiff = [
        ...existingActive.filter((x) => x.dayKey < today && !newKeys.has(x.id)).map((x) => x.id),
        ...entries.filter((e) => e.dayKey < today && !existingActive.some((x) => x.id === `${e.employeeId}_${e.dayKey}_${e.shiftId}`)).map((e) => `${e.employeeId}_${e.dayKey}_${e.shiftId}`),
    ];
    if (pastDiff.length)
        (0, errors_1.fail)('PRECONDITION', 'Không được thêm/bỏ ca của những ngày đã qua. Dùng điều chỉnh công để xử lý.', { reason: 'PAST_DAY', entries: pastDiff.slice(0, 50) });
    // Thiếu giáo viên: cảnh báo; chặn nếu chưa xác nhận.
    const shortages = await (0, hr_common_1.computeShortages)(ctx, campusId, entries.map((e) => ({ employeeId: e.employeeId, dayKey: e.dayKey })), campus);
    if (shortages.length && p?.acknowledgeShortage !== true) {
        (0, errors_1.fail)('PRECONDITION', `Thiếu giáo viên ở ${shortages.length} lớp-ngày. Xác nhận (acknowledgeShortage) để vẫn công bố.`, { reason: 'TEACHER_SHORTAGE', shortages: shortages.slice(0, 100) });
    }
    const rosterId = `${campusId}_${fromDay}_${toDay}`;
    const rref = ctx.doc(`rosters/${rosterId}`);
    const rs = await rref.get();
    const prevVersion = rs.data()?.version ?? 0;
    const prevMap = new Map(existing.map((x) => [x.id, x]));
    const now = firebase_1.Timestamp.now();
    const ops = [];
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
        if (!newKeys.has(x.id))
            ops.push((b) => b.update(ctx.doc(`rosterEntries/${x.id}`), { status: 'superseded', supersededBy: rosterId, updatedAt: now, updatedBy: ctx.uid, version: (x.version ?? 0) + 1 }));
    }
    await (0, common_1.commitOps)(ops);
    const uids = [...new Set([...empCache.values()].map((e) => e.uid).filter(Boolean))];
    if (uids.length) {
        const { sendSystemNotification } = await Promise.resolve().then(() => __importStar(require('../lib/notify')));
        await sendSystemNotification(ctx, { campusId, title: 'Lịch ca mới', body: `Lịch ca ${fromDay} → ${toDay} đã được công bố.`, category: 'hr', uids, refCollection: 'rosters', refId: rosterId }).catch(() => undefined);
    }
    await ctx.audit({ action: 'roster.publish', collection: 'rosters', docId: rosterId, campusId, after: { fromDay, toDay, entries: entries.length, shortages: shortages.length } });
    return { rosterId, entries: entries.length, shortages, version: prevVersion + 1 };
};
// ---------------------------------------------------------------- punch.record
const punchRecord = async (ctx, p) => {
    const opId = ctx.opId;
    const kind = p?.kind;
    const source = p?.source ?? 'app';
    if (kind !== 'in' && kind !== 'out')
        (0, errors_1.invalid)({ kind: 'Loại lượt chấm phải là in hoặc out.' });
    if (!['app', 'device', 'manual'].includes(source))
        (0, errors_1.invalid)({ source: 'Nguồn chấm không hợp lệ.' });
    const deviceTime = (0, common_1.toDate)(p?.deviceTime);
    if (!deviceTime)
        (0, errors_1.invalid)({ deviceTime: 'Thời gian thiết bị không hợp lệ.' });
    const serverNow = new Date();
    let location = null;
    if (p?.location) {
        const { lat, lng, accuracy } = p.location;
        if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180)
            (0, errors_1.invalid)({ location: 'Vị trí không hợp lệ.' });
        location = { lat, lng, accuracy: typeof accuracy === 'number' ? accuracy : null };
    }
    // Ai được chấm: bản thân; chấm hộ/thủ công/máy chấm công cần quyền duyệt công tại cơ sở.
    let employeeId;
    const own = ctx.member?.employeeId;
    const targetEmp = typeof p?.employeeId === 'string' ? p.employeeId : undefined;
    const delegated = source !== 'app' || (targetEmp && targetEmp !== own);
    if (delegated) {
        if (!targetEmp)
            (0, errors_1.invalid)({ employeeId: 'Chấm thủ công/thiết bị cần chỉ rõ nhân viên.' });
        employeeId = targetEmp;
    }
    else
        employeeId = (0, common_1.employeeIdOf)(ctx);
    const emp = await (0, hr_common_1.getEmployee)(ctx, employeeId);
    const campusId = p?.campusId || ctx.campusId || emp.campusId;
    const campus = await (0, store_1.getCampus)(ctx, campusId);
    if (delegated)
        ctx.require('timekeeping.approve', campusId);
    if (emp.status === 'resigned')
        (0, errors_1.fail)('PRECONDITION', 'Nhân viên đã nghỉ việc.');
    const tz = (0, common_1.tzOf)(campus);
    const today = (0, store_1.dayKeyOf)(serverNow, tz);
    if (!(await (0, hr_common_1.assignedAt)(ctx, emp, campusId, today)))
        (0, errors_1.fail)('PRECONDITION', 'Bạn chưa được phân công làm việc tại cơ sở này hôm nay.', { reason: 'NOT_ASSIGNED' });
    // Kết quả kiểm tra vị trí (không coi GPS là bằng chứng tuyệt đối).
    let result = 'ok';
    let dist = null;
    const g = campus.geofence;
    if (!location)
        result = 'no_location';
    else if (g && typeof g.lat === 'number') {
        dist = Math.round((0, time_1.distanceM)(location.lat, location.lng, g.lat, g.lng));
        if (dist - (location.accuracy ?? 0) > (g.radiusM ?? 150))
            result = 'outside_radius';
    }
    if (source === 'device')
        result = 'ok';
    const skewMin = Math.round((deviceTime.getTime() - serverNow.getTime()) / 60000);
    const effective = source === 'device' || Math.abs(skewMin) <= 10 ? deviceTime : serverNow;
    const dayKey = (0, store_1.dayKeyOf)(effective, tz);
    // Thứ tự vào/ra: lượt gốc gần nhất (không tính điều chỉnh).
    const recent = (0, common_1.asDocs)(await ctx.col('punches').where('employeeId', '==', employeeId).where('dayKey', 'in', [(0, time_1.addDays)(today, -1), today, (0, time_1.addDays)(today, 1)]).get())
        .filter((x) => x.id !== opId)
        .sort((a, b) => ((0, common_1.toDate)(a.effectiveTime)?.getTime() ?? 0) - ((0, common_1.toDate)(b.effectiveTime)?.getTime() ?? 0));
    const last = recent[recent.length - 1];
    const lastAgeH = last ? (effective.getTime() - ((0, common_1.toDate)(last.effectiveTime)?.getTime() ?? 0)) / 3_600_000 : Infinity;
    const openIn = last && last.kind === 'in' && lastAgeH < 20;
    if (kind === 'in' && openIn)
        (0, errors_1.fail)('PRECONDITION', 'Bạn đã chấm vào mà chưa chấm ra. Hãy chấm ra hoặc gửi đề nghị bổ sung.', { reason: 'PUNCH_ORDER' });
    if (kind === 'out' && !openIn)
        (0, errors_1.fail)('PRECONDITION', 'Chưa có lượt vào để chấm ra. Hãy chấm vào hoặc gửi đề nghị bổ sung.', { reason: 'PUNCH_ORDER' });
    // Ca dự kiến gần nhất với thời điểm chấm.
    let expectedShift = null;
    const es = (0, common_1.asDocs)(await ctx.col('rosterEntries').where('employeeId', '==', employeeId).where('dayKey', 'in', [(0, time_1.addDays)(dayKey, -1), dayKey]).get())
        .filter((e) => e.status !== 'superseded' && !e.actualEmployeeId);
    const swapped = (0, common_1.asDocs)(await ctx.col('rosterEntries').where('actualEmployeeId', '==', employeeId).where('dayKey', 'in', [(0, time_1.addDays)(dayKey, -1), dayKey]).get());
    let bestGap = Infinity;
    for (const e of [...es, ...swapped]) {
        const w = (0, hr_common_1.shiftWindow)(e.shiftSnapshot);
        const m = (0, time_1.minutesSinceDayStart)(e.dayKey, effective, tz);
        const gap = m < w.start ? w.start - m : m > w.end ? m - w.end : 0;
        if (gap < bestGap && gap <= 360) {
            bestGap = gap;
            expectedShift = { entryId: e.id, shiftId: e.shiftId, dayKey: e.dayKey, campusId: e.campusId, start: e.shiftSnapshot.startTime, end: e.shiftSnapshot.endTime };
        }
    }
    const doc = {
        employeeId, campusId, kind, source, deviceTime: (0, common_1.ts)(deviceTime), serverTime: (0, common_1.ts)(serverNow), effectiveTime: (0, common_1.ts)(effective), dayKey,
        clockSkewMinutes: skewMin, location, distanceM: dist, result, expectedShift, syncStatus: 'synced', immutable: true,
        recordedBy: ctx.uid, note: typeof p?.note === 'string' ? p.note.slice(0, 300) : null,
    };
    try {
        await ctx.doc(`punches/${opId}`).create({ ...doc, ...ctx.metaCreate() });
    }
    catch (e) {
        if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) {
            const s = await ctx.doc(`punches/${opId}`).get(); // gửi trùng: trả đúng lượt đã ghi
            return { id: opId, duplicate: true, result: s.data()?.result, serverTime: s.data()?.serverTime, dayKey: s.data()?.dayKey };
        }
        throw e;
    }
    if (source !== 'app' || result === 'outside_radius')
        await ctx.audit({ action: `punch.${source}`, collection: 'punches', docId: opId, campusId, after: { employeeId, kind, result } });
    return { id: opId, result, serverTime: serverNow.toISOString(), dayKey, expectedShift, hhmm: (0, store_1.hhmmOf)(effective, tz) };
};
// ---------------------------------------------------------------- punchAdjust
const punchAdjustRequest = async (ctx, p) => {
    const dayKey = (0, common_1.needDay)(p?.dayKey, 'dayKey');
    const kind = p?.kind;
    if (kind !== 'in' && kind !== 'out')
        (0, errors_1.invalid)({ kind: 'Loại lượt chấm phải là in hoặc out.' });
    const reason = (0, common_1.needStr)(p?.reason, 'reason', 500);
    if (reason.length < 5)
        (0, errors_1.invalid)({ reason: 'Nêu lý do cụ thể (tối thiểu 5 ký tự).' });
    const own = ctx.member?.employeeId;
    const employeeId = typeof p?.employeeId === 'string' ? p.employeeId : (0, common_1.employeeIdOf)(ctx);
    const emp = await (0, hr_common_1.getEmployee)(ctx, employeeId);
    const campusId = p?.campusId || emp.campusId;
    const campus = await (0, store_1.getCampus)(ctx, campusId);
    if (employeeId !== own)
        ctx.require('timekeeping.approve', campusId);
    else if (!(await (0, hr_common_1.assignedAt)(ctx, emp, campusId, dayKey)))
        (0, errors_1.fail)('PRECONDITION', 'Bạn không được phân công tại cơ sở này vào ngày đó.');
    const tz = (0, common_1.tzOf)(campus);
    if (dayKey > (0, store_1.dayKeyOf)(ctx.now, tz))
        (0, errors_1.invalid)({ dayKey: 'Không thể điều chỉnh cho ngày trong tương lai.' });
    if (await (0, hr_common_1.isPeriodLocked)(ctx, campusId, dayKey))
        (0, errors_1.fail)('PRECONDITION', `Kỳ công ${dayKey.slice(0, 7)} đã khóa. Nhân sự cần mở lại kỳ hoặc chuyển sang kỳ điều chỉnh.`, { reason: 'PERIOD_LOCKED' });
    let requestedTime;
    if (typeof p?.requestedTime === 'string' && /^\d{2}:\d{2}$/.test(p.requestedTime)) {
        requestedTime = (0, time_1.zonedTimeToDate)(p.nextDay === true ? (0, time_1.addDays)(dayKey, 1) : dayKey, p.requestedTime, tz);
    }
    else
        requestedTime = (0, common_1.toDate)(p?.requestedTime);
    if (!requestedTime)
        (0, errors_1.invalid)({ requestedTime: 'Thời gian đề nghị không hợp lệ (HH:mm hoặc ISO).' });
    const dup = (0, common_1.asDocs)(await ctx.col('punchAdjustments').where('employeeId', '==', employeeId).where('status', '==', 'pending').get()).find((a) => a.dayKey === dayKey && a.kind === kind);
    if (dup)
        (0, errors_1.fail)('CONFLICT', 'Đã có đề nghị bổ sung đang chờ duyệt cho lượt này.', { existingId: dup.id });
    const originals = (0, common_1.asDocs)(await ctx.col('punches').where('employeeId', '==', employeeId).where('dayKey', '==', dayKey).get()).filter((x) => x.kind === kind);
    const id = await (0, store_1.createDoc)(ctx, 'punchAdjustments', undefined, {
        employeeId, employeeName: emp.fullName, campusId, dayKey, kind, requestedTime: (0, common_1.ts)(requestedTime), reason,
        evidencePaths: Array.isArray(p?.evidencePaths) ? p.evidencePaths.slice(0, 10) : [], originalPunchIds: originals.map((o) => o.id), status: 'pending',
    });
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'punch_adjust', campusId, refCollection: 'punchAdjustments', refId: id,
        summary: `${emp.fullName}: bổ sung lượt ${kind === 'in' ? 'vào' : 'ra'} ngày ${dayKey}`,
        impact: { employeeId, dayKey, kind, originalPunches: originals.length, requestedAt: requestedTime.toISOString() },
    });
    await ctx.doc(`punchAdjustments/${id}`).update({ approvalId });
    return { id, approvalId, status: 'pending' };
};
async function decidePunchAdjust(ctx, id, decision, note, viaApproval) {
    const a = await (0, common_1.getInCampus)(ctx, 'punchAdjustments', id, null, 'Đề nghị điều chỉnh');
    ctx.require('timekeeping.approve', a.campusId);
    if (a.status !== 'pending')
        (0, errors_1.fail)('INVALID_STATE', 'Đề nghị này đã được xử lý.');
    (0, common_1.separateDuties)(ctx, a.createdBy, 'đề nghị bổ sung công');
    if (decision === 'approved' && (await (0, hr_common_1.isPeriodLocked)(ctx, a.campusId, a.dayKey)))
        (0, errors_1.fail)('PRECONDITION', 'Kỳ công đã khóa. Mở lại kỳ có kiểm soát hoặc chuyển sang kỳ điều chỉnh.', { reason: 'PERIOD_LOCKED' });
    // Lượt gốc KHÔNG bị xóa/ghi đè: bản điều chỉnh liên kết (originalPunchIds) được dùng khi tính công.
    await (0, store_1.updateDoc)(ctx, ctx.doc(`punchAdjustments/${id}`), {
        status: decision, decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null,
        ...(decision === 'approved' ? { effectiveTime: a.requestedTime, adjustsPunchIds: a.originalPunchIds ?? [] } : {}),
    });
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'punchAdjustments', id, decision, note);
    await ctx.audit({ action: `punchAdjust.${decision}`, collection: 'punchAdjustments', docId: id, campusId: a.campusId, reason: note, after: { employeeId: a.employeeId, dayKey: a.dayKey, kind: a.kind } });
    await (0, hr_common_1.notifyEmployee)(ctx, a.employeeId, a.campusId, 'Điều chỉnh chấm công', `Đề nghị bổ sung công ngày ${a.dayKey}: ${decision === 'approved' ? 'đã duyệt' : 'bị từ chối'}.`, { c: 'punchAdjustments', id });
    return { id, status: decision };
}
(0, approvals_1.registerApprovalHandler)('punch_adjust', {
    perm: 'timekeeping.approve',
    onApprove: (ctx, a, note) => decidePunchAdjust(ctx, a.refId, 'approved', note, true),
    onReject: (ctx, a, note) => decidePunchAdjust(ctx, a.refId, 'rejected', note, true),
});
// ---------------------------------------------------------------- staffLeave
const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'maternity', 'wedding', 'bereavement', 'other'];
const PAID_LEAVE = new Set(['annual', 'sick', 'maternity', 'wedding', 'bereavement']);
async function leaveBalance(ctx, emp, year, excludeId) {
    const entitlement = emp.annualLeaveDays ?? 12;
    const ls = (0, common_1.asDocs)(await ctx.col('staffLeaves').where('employeeId', '==', emp.id).get())
        .filter((l) => l.type === 'annual' && ['approved', 'pending'].includes(l.status) && String(l.fromDay).startsWith(year) && l.id !== excludeId);
    const used = ls.reduce((s, l) => s + (l.days ?? 0), 0);
    return { entitlement, used, remaining: entitlement - used };
}
async function leaveWarnings(ctx, campusId, campus, emp, from, to) {
    const es = (0, common_1.asDocs)(await ctx.col('rosterEntries').where('campusId', '==', campusId).where('dayKey', '>=', from).where('dayKey', '<=', to).get()).filter((e) => e.status !== 'superseded');
    const mine = es.filter((e) => (e.actualEmployeeId ?? e.employeeId) === emp.id);
    // Mô phỏng: bỏ ca của người xin nghỉ và của những người đã nghỉ phép được duyệt.
    const rest = es.filter((e) => (e.actualEmployeeId ?? e.employeeId) !== emp.id && e.status !== 'on_leave').map((e) => ({ employeeId: (e.actualEmployeeId ?? e.employeeId), dayKey: e.dayKey }));
    // chỉ xét các ngày người này có ca
    const days = new Set(mine.map((e) => e.dayKey));
    const entries = [...rest.filter((e) => days.has(e.dayKey)), ...[...days].map((d) => ({ employeeId: '__marker__', dayKey: d }))];
    const shortage = (await (0, hr_common_1.computeShortages)(ctx, campusId, entries, campus)).filter((s) => days.has(s.dayKey));
    return { affectedShifts: mine.map((e) => ({ entryId: e.id, dayKey: e.dayKey, shiftId: e.shiftId })), shortage };
}
const staffLeaveRequest = async (ctx, p) => {
    const d = (0, validate_1.validate)(p, { type: { t: 'string', req: true, oneOf: LEAVE_TYPES }, fromDay: { t: 'day', req: true }, toDay: { t: 'day', req: true }, reason: { t: 'string', req: true, min: 3, max: 500 }, handoverTo: { t: 'string', max: 128 } });
    (0, validate_1.requireRange)(d.fromDay, d.toDay);
    if ((0, time_1.dayIndex)(d.toDay) - (0, time_1.dayIndex)(d.fromDay) > 120)
        (0, errors_1.invalid)({ toDay: 'Khoảng nghỉ tối đa 120 ngày.' });
    const own = ctx.member?.employeeId;
    const employeeId = typeof p?.employeeId === 'string' ? p.employeeId : (0, common_1.employeeIdOf)(ctx);
    const emp = await (0, hr_common_1.getEmployee)(ctx, employeeId);
    const campusId = p?.campusId || emp.campusId;
    const campus = await (0, store_1.getCampus)(ctx, campusId);
    if (employeeId !== own)
        ctx.require('leave_staff.decide', campusId); // ghi nhận hộ (nghỉ đột xuất)
    else if (!(await (0, hr_common_1.assignedAt)(ctx, emp, campusId, d.fromDay)) && emp.campusId !== campusId)
        (0, errors_1.fail)('PRECONDITION', 'Bạn không thuộc cơ sở này.');
    if (d.handoverTo) {
        const h = await (0, hr_common_1.getEmployee)(ctx, d.handoverTo);
        if (h.id === emp.id)
            (0, errors_1.invalid)({ handoverTo: 'Người bàn giao phải khác bạn.' });
    }
    const clash = (0, common_1.asDocs)(await ctx.col('staffLeaves').where('employeeId', '==', employeeId).get())
        .find((l) => ['pending', 'approved'].includes(l.status) && l.fromDay <= d.toDay && l.toDay >= d.fromDay);
    if (clash)
        (0, errors_1.fail)('CONFLICT', 'Đã có đơn nghỉ trùng thời gian này.', { conflictId: clash.id });
    const { days } = await (0, hr_common_1.countWorkDays)(ctx, employeeId, d.fromDay, d.toDay);
    const paid = PAID_LEAVE.has(d.type);
    let balance = null;
    if (d.type === 'annual') {
        const b = await leaveBalance(ctx, emp, d.fromDay.slice(0, 4));
        balance = b;
        if (days > b.remaining)
            (0, errors_1.fail)('LIMIT', `Số dư phép năm không đủ: còn ${b.remaining} ngày, đề nghị ${days} ngày.`, { balance: b });
    }
    const warn = await leaveWarnings(ctx, campusId, campus, emp, d.fromDay, d.toDay);
    const today = (0, store_1.dayKeyOf)(ctx.now, (0, common_1.tzOf)(campus));
    const id = await (0, store_1.createDoc)(ctx, 'staffLeaves', undefined, {
        ...d, employeeId, employeeName: emp.fullName, campusId, days, paid, status: 'pending', warnings: warn, retroactive: d.fromDay < today, balance,
    });
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'staff_leave', campusId, refCollection: 'staffLeaves', refId: id,
        summary: `${emp.fullName} xin nghỉ ${d.type} ${d.fromDay} → ${d.toDay} (${days} ngày)`,
        impact: { days, balance, affectedShifts: warn.affectedShifts.length, teacherShortage: warn.shortage.length },
    });
    await ctx.doc(`staffLeaves/${id}`).update({ approvalId });
    return { id, approvalId, days, balance, warnings: warn, status: 'pending' };
};
async function decideStaffLeave(ctx, id, decision, note, viaApproval) {
    const l = await (0, common_1.getInCampus)(ctx, 'staffLeaves', id, null, 'Đơn nghỉ');
    ctx.require('leave_staff.decide', l.campusId);
    if (l.status !== 'pending')
        (0, errors_1.fail)('INVALID_STATE', 'Đơn nghỉ này đã được xử lý.');
    (0, common_1.separateDuties)(ctx, l.createdBy, 'đơn nghỉ');
    const emp = await (0, hr_common_1.getEmployee)(ctx, l.employeeId);
    let warnings = l.warnings;
    if (decision === 'approved') {
        for (const dk of [l.fromDay, l.toDay])
            if (await (0, hr_common_1.isPeriodLocked)(ctx, l.campusId, dk))
                (0, errors_1.fail)('PRECONDITION', 'Kỳ công liên quan đã khóa; mở lại kỳ trước khi duyệt nghỉ.', { reason: 'PERIOD_LOCKED' });
        if (l.type === 'annual') {
            const b = await leaveBalance(ctx, emp, String(l.fromDay).slice(0, 4), id);
            if (l.days > b.remaining)
                (0, errors_1.fail)('LIMIT', `Số dư phép năm không đủ: còn ${b.remaining} ngày.`, { balance: b });
        }
        const campus = await (0, store_1.getCampus)(ctx, l.campusId);
        warnings = await leaveWarnings(ctx, l.campusId, campus, emp, l.fromDay, l.toDay); // cảnh báo thiếu GV: quản lý đã nhìn thấy khi duyệt
    }
    await (0, store_1.updateDoc)(ctx, ctx.doc(`staffLeaves/${id}`), { status: decision, decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null, warnings });
    if (decision === 'approved') {
        // Cập nhật lịch: ca của ngày nghỉ gắn leaveId (tính công sẽ lấy phép có/không lương).
        const es = (0, common_1.asDocs)(await ctx.col('rosterEntries').where('employeeId', '==', l.employeeId).where('dayKey', '>=', l.fromDay).where('dayKey', '<=', l.toDay).get()).filter((e) => e.status !== 'superseded');
        await (0, common_1.commitOps)(es.map((e) => (b) => b.update(ctx.doc(`rosterEntries/${e.id}`), { status: 'on_leave', leaveId: id, updatedAt: firebase_1.Timestamp.now(), updatedBy: ctx.uid, version: (e.version ?? 0) + 1 })));
    }
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'staffLeaves', id, decision, note);
    await ctx.audit({ action: `staffLeave.${decision}`, collection: 'staffLeaves', docId: id, campusId: l.campusId, reason: note, after: { employeeId: l.employeeId, fromDay: l.fromDay, toDay: l.toDay, days: l.days } });
    await (0, hr_common_1.notifyEmployee)(ctx, l.employeeId, l.campusId, 'Đơn nghỉ phép', `Đơn nghỉ ${l.fromDay} → ${l.toDay}: ${decision === 'approved' ? 'đã duyệt' : 'bị từ chối'}.`, { c: 'staffLeaves', id });
    return { id, status: decision, warnings };
}
(0, approvals_1.registerApprovalHandler)('staff_leave', {
    perm: 'leave_staff.decide',
    onApprove: (ctx, a, note) => decideStaffLeave(ctx, a.refId, 'approved', note, true),
    onReject: (ctx, a, note) => decideStaffLeave(ctx, a.refId, 'rejected', note, true),
});
// ---------------------------------------------------------------- shiftSwap
const shiftSwapRequest = async (ctx, p) => {
    const entry = await (0, common_1.getInCampus)(ctx, 'rosterEntries', p?.entryId, null, 'Ca làm');
    const me = (0, common_1.employeeIdOf)(ctx);
    if ((entry.actualEmployeeId ?? entry.employeeId) !== me)
        (0, errors_1.fail)('PERMISSION_DENIED', 'Đây không phải ca của bạn.');
    if (entry.status === 'superseded' || entry.status === 'on_leave')
        (0, errors_1.fail)('INVALID_STATE', 'Ca này không còn hiệu lực để đổi.');
    const toId = (0, common_1.needStr)(p?.toEmployeeId, 'toEmployeeId');
    if (toId === me)
        (0, errors_1.invalid)({ toEmployeeId: 'Người nhận ca phải khác bạn.' });
    const to = await (0, hr_common_1.getEmployee)(ctx, toId);
    const campus = await (0, store_1.getCampus)(ctx, entry.campusId);
    assertFuture(ctx, entry.dayKey, (0, store_1.dayKeyOf)(ctx.now, (0, common_1.tzOf)(campus)));
    if (!(await (0, hr_common_1.assignedAt)(ctx, to, entry.campusId, entry.dayKey)))
        (0, errors_1.fail)('PRECONDITION', `${to.fullName} chưa được phân công tại cơ sở này.`);
    await assertNoOverlap(ctx, toId, entry);
    const open = (0, common_1.asDocs)(await ctx.col('shiftSwaps').where('entryId', '==', entry.id).get()).find((s) => ['awaiting_peer', 'awaiting_manager'].includes(s.status));
    if (open)
        (0, errors_1.fail)('CONFLICT', 'Ca này đang có yêu cầu đổi chưa hoàn tất.');
    const from = await (0, hr_common_1.getEmployee)(ctx, me);
    const id = await (0, store_1.createDoc)(ctx, 'shiftSwaps', undefined, {
        campusId: entry.campusId, entryId: entry.id, dayKey: entry.dayKey, shiftId: entry.shiftId, fromEmployeeId: me, fromName: from.fullName,
        toEmployeeId: toId, toName: to.fullName, reason: typeof p?.reason === 'string' ? p.reason.slice(0, 500) : '', status: 'awaiting_peer',
    });
    await (0, hr_common_1.notifyEmployee)(ctx, toId, entry.campusId, 'Đề nghị đổi ca', `${from.fullName} đề nghị đổi ca ngày ${entry.dayKey} cho bạn.`, { c: 'shiftSwaps', id });
    return { id, status: 'awaiting_peer' };
};
function assertFuture(_ctx, day, today) {
    if (day < today)
        (0, errors_1.fail)('PRECONDITION', 'Không đổi ca của ngày đã qua (không sửa ca quá khứ để che đi muộn).', { reason: 'PAST_DAY' });
}
async function assertNoOverlap(ctx, employeeId, entry) {
    const w = (0, hr_common_1.shiftWindow)(entry.shiftSnapshot);
    const a1 = (0, time_1.dayIndex)(entry.dayKey) * 1440 + w.start;
    const a2 = (0, time_1.dayIndex)(entry.dayKey) * 1440 + w.end;
    const others = [
        ...(0, common_1.asDocs)(await ctx.col('rosterEntries').where('employeeId', '==', employeeId).where('dayKey', 'in', [(0, time_1.addDays)(entry.dayKey, -1), entry.dayKey, (0, time_1.addDays)(entry.dayKey, 1)]).get()).filter((o) => !o.actualEmployeeId),
        ...(0, common_1.asDocs)(await ctx.col('rosterEntries').where('actualEmployeeId', '==', employeeId).where('dayKey', 'in', [(0, time_1.addDays)(entry.dayKey, -1), entry.dayKey, (0, time_1.addDays)(entry.dayKey, 1)]).get()),
    ].filter((o) => o.id !== entry.id && o.status !== 'superseded');
    for (const o of others) {
        const ow = (0, hr_common_1.shiftWindow)(o.shiftSnapshot);
        if ((0, time_1.overlaps)(a1, a2, (0, time_1.dayIndex)(o.dayKey) * 1440 + ow.start, (0, time_1.dayIndex)(o.dayKey) * 1440 + ow.end))
            (0, errors_1.fail)('PRECONDITION', 'Người nhận đã có ca trùng thời gian với ca này.', { reason: 'SHIFT_OVERLAP', conflictEntry: o.id });
    }
}
const shiftSwapRespond = async (ctx, p) => {
    const sw = await (0, common_1.getInCampus)(ctx, 'shiftSwaps', p?.id, null, 'Yêu cầu đổi ca');
    if (sw.toEmployeeId !== ctx.member?.employeeId)
        (0, errors_1.fail)('PERMISSION_DENIED', 'Chỉ người được đề nghị nhận ca mới trả lời.');
    if (sw.status !== 'awaiting_peer')
        (0, errors_1.fail)('INVALID_STATE', 'Yêu cầu đã được trả lời.');
    const accept = p?.accept === true;
    if (!accept) {
        await (0, store_1.updateDoc)(ctx, ctx.doc(`shiftSwaps/${sw.id}`), { status: 'declined_by_peer', peerRespondedAt: firebase_1.Timestamp.now(), peerNote: p?.note ?? null });
        await (0, hr_common_1.notifyEmployee)(ctx, sw.fromEmployeeId, sw.campusId, 'Đổi ca', `${sw.toName} đã từ chối nhận ca ngày ${sw.dayKey}.`, { c: 'shiftSwaps', id: sw.id });
        return { id: sw.id, status: 'declined_by_peer' };
    }
    const entry = await (0, common_1.getInCampus)(ctx, 'rosterEntries', sw.entryId, null, 'Ca làm');
    await assertNoOverlap(ctx, sw.toEmployeeId, entry);
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'shift_swap', campusId: sw.campusId, refCollection: 'shiftSwaps', refId: sw.id,
        summary: `Đổi ca ${sw.dayKey}: ${sw.fromName} → ${sw.toName}`, impact: { dayKey: sw.dayKey, shiftId: sw.shiftId, from: sw.fromEmployeeId, to: sw.toEmployeeId },
    });
    await (0, store_1.updateDoc)(ctx, ctx.doc(`shiftSwaps/${sw.id}`), { status: 'awaiting_manager', peerRespondedAt: firebase_1.Timestamp.now(), peerNote: p?.note ?? null, approvalId });
    return { id: sw.id, status: 'awaiting_manager', approvalId };
};
async function decideShiftSwap(ctx, id, decision, note, viaApproval) {
    const sw = await (0, common_1.getInCampus)(ctx, 'shiftSwaps', id, null, 'Yêu cầu đổi ca');
    ctx.require('leave_staff.decide', sw.campusId);
    if (sw.status !== 'awaiting_manager')
        (0, errors_1.fail)('INVALID_STATE', sw.status === 'awaiting_peer' ? 'Người nhận ca chưa đồng ý.' : 'Yêu cầu đã được xử lý.');
    if (decision === 'approved') {
        const entry = await (0, common_1.getInCampus)(ctx, 'rosterEntries', sw.entryId, null, 'Ca làm');
        const campus = await (0, store_1.getCampus)(ctx, sw.campusId);
        assertFuture(ctx, entry.dayKey, (0, store_1.dayKeyOf)(ctx.now, (0, common_1.tzOf)(campus)));
        if (await (0, hr_common_1.isPeriodLocked)(ctx, sw.campusId, entry.dayKey))
            (0, errors_1.fail)('PRECONDITION', 'Kỳ công đã khóa.', { reason: 'PERIOD_LOCKED' });
        await assertNoOverlap(ctx, sw.toEmployeeId, entry);
        // Lưu người làm THỰC TẾ; employeeId gốc giữ nguyên để truy vết.
        await (0, store_1.updateDoc)(ctx, ctx.doc(`rosterEntries/${entry.id}`), { actualEmployeeId: sw.toEmployeeId, swapId: sw.id });
    }
    await (0, store_1.updateDoc)(ctx, ctx.doc(`shiftSwaps/${id}`), { status: decision, decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null });
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'shiftSwaps', id, decision, note);
    await ctx.audit({ action: `shiftSwap.${decision}`, collection: 'shiftSwaps', docId: id, campusId: sw.campusId, reason: note, after: { entryId: sw.entryId, to: sw.toEmployeeId } });
    for (const e of [sw.fromEmployeeId, sw.toEmployeeId])
        await (0, hr_common_1.notifyEmployee)(ctx, e, sw.campusId, 'Đổi ca', `Đổi ca ngày ${sw.dayKey}: ${decision === 'approved' ? 'đã duyệt' : 'bị từ chối'}.`, { c: 'shiftSwaps', id });
    return { id, status: decision };
}
(0, approvals_1.registerApprovalHandler)('shift_swap', {
    perm: 'leave_staff.decide',
    onApprove: (ctx, a, note) => decideShiftSwap(ctx, a.refId, 'approved', note, true),
    onReject: (ctx, a, note) => decideShiftSwap(ctx, a.refId, 'rejected', note, true),
});
// ---------------------------------------------------------------- overtime
const overtimeRequest = async (ctx, p) => {
    const dayKey = (0, common_1.needDay)(p?.dayKey, 'dayKey');
    const d = (0, validate_1.validate)(p, { minutes: { t: 'int', req: true, min: 15, max: 720 }, reason: { t: 'string', req: true, min: 3, max: 500 } });
    const own = ctx.member?.employeeId;
    const employeeId = typeof p?.employeeId === 'string' ? p.employeeId : (0, common_1.employeeIdOf)(ctx);
    const emp = await (0, hr_common_1.getEmployee)(ctx, employeeId);
    const campusId = p?.campusId || emp.campusId;
    await (0, store_1.getCampus)(ctx, campusId);
    if (employeeId !== own)
        ctx.require('timekeeping.approve', campusId);
    else if (!(await (0, hr_common_1.assignedAt)(ctx, emp, campusId, dayKey)))
        (0, errors_1.fail)('PRECONDITION', 'Bạn không được phân công tại cơ sở này vào ngày đó.');
    if (await (0, hr_common_1.isPeriodLocked)(ctx, campusId, dayKey))
        (0, errors_1.fail)('PRECONDITION', 'Kỳ công đã khóa.', { reason: 'PERIOD_LOCKED' });
    const dup = (0, common_1.asDocs)(await ctx.col('overtimeRequests').where('employeeId', '==', employeeId).where('dayKey', '==', dayKey).get()).find((o) => ['pending', 'approved'].includes(o.status));
    if (dup)
        (0, errors_1.fail)('CONFLICT', 'Đã có đề nghị tăng ca cho ngày này.', { existingId: dup.id });
    const id = await (0, store_1.createDoc)(ctx, 'overtimeRequests', undefined, { ...d, employeeId, employeeName: emp.fullName, campusId, dayKey, status: 'pending', approvedMinutes: 0 });
    const approvalId = await (0, approvals_1.createApproval)(ctx, {
        type: 'overtime', campusId, refCollection: 'overtimeRequests', refId: id,
        summary: `${emp.fullName} đề nghị tăng ca ${d.minutes} phút ngày ${dayKey}`, impact: { minutes: d.minutes, dayKey },
    });
    await ctx.doc(`overtimeRequests/${id}`).update({ approvalId });
    return { id, approvalId, status: 'pending' };
};
async function decideOvertime(ctx, id, decision, note, approvedMinutes, viaApproval) {
    const o = await (0, common_1.getInCampus)(ctx, 'overtimeRequests', id, null, 'Đề nghị tăng ca');
    ctx.require('timekeeping.approve', o.campusId);
    if (o.status !== 'pending')
        (0, errors_1.fail)('INVALID_STATE', 'Đề nghị tăng ca đã được xử lý.');
    (0, common_1.separateDuties)(ctx, o.createdBy, 'đề nghị tăng ca');
    if (decision === 'approved' && (await (0, hr_common_1.isPeriodLocked)(ctx, o.campusId, o.dayKey)))
        (0, errors_1.fail)('PRECONDITION', 'Kỳ công đã khóa.', { reason: 'PERIOD_LOCKED' });
    const am = decision === 'approved' ? Math.min(o.minutes, approvedMinutes ?? o.minutes) : 0;
    if (decision === 'approved' && (!Number.isInteger(am) || am <= 0))
        (0, errors_1.invalid)({ approvedMinutes: 'Số phút duyệt phải là số nguyên dương.' });
    await (0, store_1.updateDoc)(ctx, ctx.doc(`overtimeRequests/${id}`), { status: decision, approvedMinutes: am, decidedBy: ctx.uid, decidedAt: firebase_1.Timestamp.now(), decisionNote: note ?? null });
    if (!viaApproval)
        await (0, common_1.syncApproval)(ctx, 'overtimeRequests', id, decision, note);
    await ctx.audit({ action: `overtime.${decision}`, collection: 'overtimeRequests', docId: id, campusId: o.campusId, reason: note, after: { approvedMinutes: am } });
    return { id, status: decision, approvedMinutes: am };
}
(0, approvals_1.registerApprovalHandler)('overtime', {
    perm: 'timekeeping.approve',
    onApprove: (ctx, a, note) => decideOvertime(ctx, a.refId, 'approved', note, undefined, true),
    onReject: (ctx, a, note) => decideOvertime(ctx, a.refId, 'rejected', note, undefined, true),
});
// ---------------------------------------------------------------- actions
exports.actions = {
    'employee.save': { scope: 'org', perm: 'staff.write', handler: employeeSave },
    'employee.assign': { scope: 'org', perm: 'staff.write', handler: employeeAssign },
    'roster.publish': { scope: 'org', perm: 'roster.write', handler: rosterPublish },
    'punch.record': { scope: 'org', idempotent: true, handler: punchRecord },
    'punchAdjust.request': { scope: 'org', handler: punchAdjustRequest },
    'punchAdjust.decide': {
        scope: 'org', handler: (ctx, p) => decidePunchAdjust(ctx, p?.id, (0, common_1.needDecision)(p?.decision), p?.note, false),
    },
    'staffLeave.request': { scope: 'org', handler: staffLeaveRequest },
    'staffLeave.decide': { scope: 'org', handler: (ctx, p) => decideStaffLeave(ctx, p?.id, (0, common_1.needDecision)(p?.decision), p?.note, false) },
    'shiftSwap.request': { scope: 'org', handler: shiftSwapRequest },
    'shiftSwap.respond': { scope: 'org', handler: shiftSwapRespond },
    'shiftSwap.decide': { scope: 'org', handler: (ctx, p) => decideShiftSwap(ctx, p?.id, (0, common_1.needDecision)(p?.decision), p?.note, false) },
    'overtime.request': { scope: 'org', handler: overtimeRequest },
    'overtime.decide': { scope: 'org', handler: (ctx, p) => decideOvertime(ctx, p?.id, (0, common_1.needDecision)(p?.decision), p?.note, p?.approvedMinutes, false) },
    ...hr_timesheet_1.actions,
};
