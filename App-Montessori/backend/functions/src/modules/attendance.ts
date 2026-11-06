import type { DocumentData } from 'firebase-admin/firestore';
import { FieldValue, Timestamp, db } from '../core/firebase';
import { denied, fail, invalid } from '../core/errors';
import { createApproval, registerApprovalHandler, ApprovalDoc } from '../core/approvals';
import { createDoc, dayKeyOf, getOr404, hhmmOf, updateDoc } from '../core/store';
import { TIME_RE } from '../core/validate';
import type { ActionMap, Ctx } from '../core/types';
import { decideApprovalCore } from './approval-core';
import {
  asArr, asObj, campusOf, chunk, ChildDoc, childOf, classOf, daysBetween, parentUidsOfChild, pushToUsers, requireClassAccess,
  requireDay, requireId, requireParentOf, s, todayOf, tsOf, parseWhen,
} from './util';

export const ATT_STATUSES = ['present', 'absent_excused', 'absent_unexcused', 'no_class'] as const;
const SESSIONS = ['all', 'am', 'pm'] as const;
const IN_SCHOOL = ['active', 'trial', 'on_leave'];
const VERIFY_METHODS = ['id_check', 'qr', 'otp', 'phone_call'] as const;

const attId = (childId: string, dayKey: string, session: string) => `${childId}_${dayKey}_${session}`;
const hoId = (childId: string, dayKey: string) => `${childId}_${dayKey}`;

function checkDayNotFuture(ctx: Ctx, campus: { timezone?: string }, dayKey: string, field = 'dayKey'): void {
  if (dayKey > todayOf(ctx, campus)) invalid({ [field]: 'Không thể ghi cho ngày ở tương lai.' });
}

// ------------------------------------------------------------------ điểm danh

registerApprovalHandler('attendance_correction', {
  perm: 'classes.write', // quản lý lớp/hiệu trưởng duyệt; giáo viên không tự duyệt
  async onApprove(ctx: Ctx, ap: ApprovalDoc) {
    const corrRef = ctx.doc(`attendanceCorrections/${ap.refId}`);
    const corr = await getOr404(corrRef, 'Yêu cầu sửa điểm danh');
    if (corr.status !== 'pending') fail('INVALID_STATE', 'Yêu cầu sửa không còn chờ duyệt.');
    const attRef = ctx.doc(`attendance/${corr.attendanceId}`);
    const cur = await getOr404(attRef, 'Bản ghi điểm danh');
    const after = asObj(corr.after);
    const patch: Record<string, any> = {};
    for (const k of ['status', 'arrivedAt', 'note', 'healthNote']) if (k in after) patch[k] = after[k] ?? null;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, cur[k] ?? null]));
    await attRef.update({
      ...patch,
      corrections: FieldValue.arrayUnion({ id: corr.id, before, after: patch, reason: corr.reason, requestedBy: corr.requestedBy, approvedBy: ctx.uid, at: Timestamp.fromDate(ctx.now) }),
      correctionCount: FieldValue.increment(1),
      ...ctx.metaUpdate((cur.version as number) ?? 1),
    });
    await corrRef.update({ status: 'approved', before, approvedBy: ctx.uid, decidedAt: Timestamp.fromDate(ctx.now), ...ctx.metaUpdate((corr.version as number) ?? 1) });
    await ctx.audit({ action: 'attendance.correction.apply', collection: 'attendance', docId: corr.attendanceId, campusId: corr.campusId, before, after: patch, reason: corr.reason });
    return { attendanceId: corr.attendanceId, before, after: patch };
  },
  async onReject(ctx: Ctx, ap: ApprovalDoc, note?: string) {
    const corrRef = ctx.doc(`attendanceCorrections/${ap.refId}`);
    const corr = await corrRef.get();
    if (corr.exists && corr.data()!.status === 'pending') {
      await corrRef.update({ status: 'rejected', rejectedBy: ctx.uid, decisionNote: s(note), decidedAt: Timestamp.fromDate(ctx.now), ...ctx.metaUpdate((corr.data()!.version as number) ?? 1) });
    }
    return null;
  },
});

/** Danh sách trẻ có phân lớp hiệu lực tại lớp vào ngày dayKey (map childId → enrollment). */
async function classRoster(ctx: Ctx, classId: string, dayKey: string): Promise<Set<string>> {
  const q = await ctx.col('enrollments').where('classId', '==', classId).get();
  const out = new Set<string>();
  for (const d of q.docs) {
    const e = d.data();
    if (e.status === 'cancelled') continue;
    if ((!e.startDate || e.startDate <= dayKey) && (!e.endDate || dayKey <= e.endDate)) out.add(e.childId);
  }
  return out;
}

function sanitizeItem(raw: unknown, idx: number) {
  const it = asObj(raw);
  const childId = requireId(it.childId, `items[${idx}].childId`);
  const status = s(it.status);
  if (!(ATT_STATUSES as readonly string[]).includes(status)) invalid({ [`items[${idx}].status`]: 'Trạng thái điểm danh không hợp lệ.' });
  let arrivedAt: Timestamp | null = null;
  if (it.arrivedAt) { const d = parseWhen(it.arrivedAt, `items[${idx}].arrivedAt`); arrivedAt = Timestamp.fromDate(d!); }
  if (status !== 'present' && arrivedAt) invalid({ [`items[${idx}].arrivedAt`]: 'Chỉ nhập giờ đến cho trẻ có mặt.' });
  return {
    childId, status, arrivedAt, droppedBy: s(it.droppedBy) || null, note: s(it.note).slice(0, 500) || null, healthNote: s(it.healthNote).slice(0, 500) || null,
  };
}

export const actions: ActionMap = {
  'attendance.mark': {
    scope: 'campus',
    perm: 'attendance.write',
    idempotent: true,
    handler: async (ctx, p) => {
      const b = asObj(p);
      const campusId = ctx.campusId!;
      const cls = await classOf(ctx, b.classId);
      if (cls.campusId !== campusId) denied('Lớp không thuộc cơ sở của yêu cầu.');
      await requireClassAccess(ctx, campusId, cls.id);
      const campus = await campusOf(ctx, campusId);
      const dayKey = requireDay(b.dayKey, 'dayKey');
      checkDayNotFuture(ctx, campus, dayKey);
      const session = s(b.session) || 'all';
      if (!(SESSIONS as readonly string[]).includes(session)) invalid({ session: 'Buổi phải là all, am hoặc pm.' });
      const rawItems = asArr(b.items);
      if (!rawItems.length) invalid({ items: 'Danh sách điểm danh trống.' });
      if (rawItems.length > 200) invalid({ items: 'Tối đa 200 trẻ mỗi lần gửi.' });
      const byChild = new Map<string, ReturnType<typeof sanitizeItem>>();
      rawItems.forEach((r, i) => { const it = sanitizeItem(r, i); byChild.set(it.childId, it); });

      const closure = await ctx.doc(`attendanceClosures/${cls.id}_${dayKey}`).get();
      if (closure.exists) fail('INVALID_STATE', 'Điểm danh ngày này đã chốt. Hãy gửi yêu cầu sửa điểm danh (attendance.requestCorrection).', { reason: 'closed' });

      const roster = await classRoster(ctx, cls.id, dayKey);
      const saved: any[] = [];
      const rejected: any[] = [];
      const items = [...byChild.values()];
      for (const it of items) if (!roster.has(it.childId)) rejected.push({ childId: it.childId, reason: 'Trẻ không thuộc lớp này trong ngày đã chọn.' });
      const valid = items.filter((it) => roster.has(it.childId));
      const nowTs = Timestamp.fromDate(ctx.now);
      const doneAt = nowTs;

      for (const part of chunk(valid, 150)) {
        const r = await ctx.tx(async (t) => {
          const lSaved: any[] = []; const lRejected: any[] = [];
          const reads = await Promise.all(part.map(async (it) => {
            const ids = SESSIONS.map((ss) => attId(it.childId, dayKey, ss));
            const snaps = await Promise.all(ids.map((id) => t.get(ctx.doc(`attendance/${id}`))));
            return { it, snaps };
          }));
          for (const { it, snaps } of reads) {
            const mine = snaps[SESSIONS.indexOf(session as any)];
            const clash = snaps.find((sn, i) => sn.exists && SESSIONS[i] !== session && (session === 'all' || SESSIONS[i] === 'all'));
            if (clash) { lRejected.push({ childId: it.childId, reason: 'Đã có điểm danh theo buổi/cả ngày khác cho trẻ này.' }); continue; }
            if (mine.exists && mine.data()!.closed === true) { lRejected.push({ childId: it.childId, reason: 'Bản ghi đã chốt, cần yêu cầu sửa.' }); continue; }
            const ref = ctx.doc(`attendance/${attId(it.childId, dayKey, session)}`);
            if (!mine.exists) {
              t.create(ref, {
                childId: it.childId, classId: cls.id, campusId, dayKey, session, status: it.status, arrivedAt: it.arrivedAt, droppedBy: it.droppedBy,
                note: it.note, healthNote: it.healthNote, closed: false, markedBy: ctx.uid, markedByName: ctx.member?.displayName ?? ctx.uid, markedAt: doneAt,
                ...ctx.metaCreate(),
              });
              lSaved.push({ childId: it.childId, id: ref.id, status: it.status, created: true });
            } else {
              const cur = mine.data()!;
              const upd: Record<string, any> = {
                status: it.status, arrivedAt: it.arrivedAt ?? cur.arrivedAt ?? null, droppedBy: it.droppedBy ?? cur.droppedBy ?? null,
                note: it.note ?? cur.note ?? null, healthNote: it.healthNote ?? cur.healthNote ?? null,
                lastMarkedBy: ctx.uid, lastMarkedAt: doneAt, ...ctx.metaUpdate((cur.version as number) ?? 1),
              };
              if (cur.status !== it.status) upd.changes = FieldValue.arrayUnion({ from: cur.status, to: it.status, by: ctx.uid, at: doneAt });
              t.update(ref, upd);
              lSaved.push({ childId: it.childId, id: ref.id, status: it.status, created: false });
            }
          }
          return { lSaved, lRejected };
        });
        saved.push(...r.lSaved); rejected.push(...r.lRejected);
      }
      await ctx.audit({
        action: 'attendance.mark', collection: 'attendance', docId: `${cls.id}_${dayKey}_${session}`, campusId,
        after: { classId: cls.id, dayKey, session, saved: saved.length, rejected: rejected.length },
      });
      return { classId: cls.id, dayKey, session, saved, rejected };
    },
  },

  'attendance.close': {
    scope: 'campus',
    perm: 'attendance.write',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const campusId = ctx.campusId!;
      const cls = await classOf(ctx, b.classId);
      if (cls.campusId !== campusId) denied('Lớp không thuộc cơ sở của yêu cầu.');
      await requireClassAccess(ctx, campusId, cls.id);
      const campus = await campusOf(ctx, campusId);
      const dayKey = requireDay(b.dayKey, 'dayKey');
      checkDayNotFuture(ctx, campus, dayKey);
      const closureRef = ctx.doc(`attendanceClosures/${cls.id}_${dayKey}`);
      if ((await closureRef.get()).exists) return { classId: cls.id, dayKey, alreadyClosed: true };
      const roster = await classRoster(ctx, cls.id, dayKey);
      const q = await ctx.col('attendance').where('classId', '==', cls.id).where('dayKey', '==', dayKey).get();
      const marked = new Set(q.docs.map((d) => d.data().childId as string));
      const missing = [...roster].filter((c) => !marked.has(c));
      if (missing.length && b.allowUnconfirmed !== true) {
        fail('PRECONDITION', `Còn ${missing.length} trẻ chưa được điểm danh. Hoàn tất hoặc chọn chốt với trạng thái "Chưa xác nhận".`, { missingChildIds: missing });
      }
      const nowTs = Timestamp.fromDate(ctx.now);
      for (const part of chunk(missing, 400)) {
        const batch = db.batch();
        for (const childId of part) {
          batch.create(ctx.doc(`attendance/${attId(childId, dayKey, 'all')}`), {
            childId, classId: cls.id, campusId, dayKey, session: 'all', status: 'unconfirmed', closed: false, markedBy: ctx.uid, markedAt: nowTs, ...ctx.metaCreate(),
          });
        }
        await batch.commit();
      }
      try {
        await closureRef.create({
          classId: cls.id, campusId, dayKey, closedBy: ctx.uid, closedByName: ctx.member?.displayName ?? ctx.uid, closedAt: nowTs,
          total: roster.size, unconfirmed: missing.length, ...ctx.metaCreate(),
        });
      } catch {
        return { classId: cls.id, dayKey, alreadyClosed: true };
      }
      const all = await ctx.col('attendance').where('classId', '==', cls.id).where('dayKey', '==', dayKey).get();
      for (const part of chunk(all.docs, 400)) {
        const batch = db.batch();
        part.forEach((d) => batch.update(d.ref, { closed: true, closedAt: nowTs, closedBy: ctx.uid }));
        await batch.commit();
      }
      await ctx.audit({ action: 'attendance.close', collection: 'attendanceClosures', docId: `${cls.id}_${dayKey}`, campusId, after: { total: roster.size, unconfirmed: missing.length } });
      return { classId: cls.id, dayKey, closed: true, total: roster.size, unconfirmed: missing.length };
    },
  },

  'attendance.requestCorrection': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const attendanceId = requireId(b.attendanceId, 'attendanceId');
      const att = await getOr404(ctx.doc(`attendance/${attendanceId}`), 'Bản ghi điểm danh');
      ctx.require('attendance.write', att.campusId);
      await requireClassAccess(ctx, att.campusId, att.classId);
      if (att.closed !== true) fail('INVALID_STATE', 'Điểm danh chưa chốt, hãy sửa trực tiếp bằng attendance.mark.');
      const reason = s(b.reason);
      if (!reason) invalid({ reason: 'Vui lòng nhập lý do sửa.' });
      const nv = asObj(b.newValue);
      const after: Record<string, any> = {};
      if (nv.status !== undefined) {
        if (!([...ATT_STATUSES, 'unconfirmed'] as readonly string[]).includes(s(nv.status)) || s(nv.status) === 'unconfirmed') invalid({ 'newValue.status': 'Trạng thái không hợp lệ.' });
        after.status = s(nv.status);
      }
      if (nv.arrivedAt !== undefined) after.arrivedAt = nv.arrivedAt ? Timestamp.fromDate(parseWhen(nv.arrivedAt, 'newValue.arrivedAt')!) : null;
      if (nv.note !== undefined) after.note = s(nv.note).slice(0, 500) || null;
      if (nv.healthNote !== undefined) after.healthNote = s(nv.healthNote).slice(0, 500) || null;
      if (!Object.keys(after).length) invalid({ newValue: 'Chưa có giá trị mới.' });
      const dup = await ctx.col('attendanceCorrections').where('attendanceId', '==', attendanceId).where('status', '==', 'pending').limit(1).get();
      if (!dup.empty) fail('CONFLICT', 'Đã có yêu cầu sửa đang chờ duyệt cho bản ghi này.', { correctionId: dup.docs[0].id });
      const before = Object.fromEntries(Object.keys(after).map((k) => [k, att[k] ?? null]));
      const corrId = await createDoc(ctx, 'attendanceCorrections', undefined, {
        attendanceId, childId: att.childId, classId: att.classId, campusId: att.campusId, dayKey: att.dayKey, before, after, reason,
        status: 'pending', requestedBy: ctx.uid, requestedByName: ctx.member?.displayName ?? ctx.uid,
      });
      const child = await getOr404(ctx.doc(`children/${att.childId}`), 'Hồ sơ trẻ');
      const approvalId = await createApproval(ctx, {
        type: 'attendance_correction', campusId: att.campusId, refCollection: 'attendanceCorrections', refId: corrId,
        summary: `Sửa điểm danh ${child.fullName} ngày ${att.dayKey}: ${before.status ?? att.status} → ${after.status ?? att.status}.`,
        impact: { attendanceId, dayKey: att.dayKey, before, after, reason },
      });
      await ctx.doc(`attendanceCorrections/${corrId}`).update({ approvalId });
      await ctx.audit({ action: 'attendance.requestCorrection', collection: 'attendanceCorrections', docId: corrId, campusId: att.campusId, before, after, reason });
      return { id: corrId, approvalId, status: 'pending' };
    },
  },

  'attendance.decideCorrection': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const corr = await getOr404(ctx.doc(`attendanceCorrections/${requireId(b.id, 'id')}`), 'Yêu cầu sửa điểm danh');
      if (!corr.approvalId) fail('INVALID_STATE', 'Yêu cầu sửa thiếu phiếu phê duyệt.');
      const r: any = await decideApprovalCore(ctx, corr.approvalId, s(b.decision), s(b.note));
      return { id: corr.id, approvalId: corr.approvalId, status: r.status, result: r.result ?? null };
    },
  },

  // ---------------------------------------------------------------- bàn giao
  'handover.receive': {
    scope: 'org',
    idempotent: true,
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      ctx.require('handover.write', child.campusId);
      await requireClassAccess(ctx, child.campusId, child.classId ?? null);
      if (!IN_SCHOOL.includes(child.status) || !child.classId) fail('INVALID_STATE', 'Trẻ không ở trạng thái đang học nên chưa thể nhận.');
      const campus = await campusOf(ctx, child.campusId);
      const dayKey = requireDay(b.dayKey, 'dayKey');
      checkDayNotFuture(ctx, campus, dayKey);
      const droppedBy = s(b.droppedBy);
      if (!droppedBy) invalid({ droppedBy: 'Vui lòng ghi người đưa trẻ.' });
      const at = pickTime(ctx, b.at);
      const ref = ctx.doc(`handovers/${hoId(child.id, dayKey)}`);
      const attRef = ctx.doc(`attendance/${attId(child.id, dayKey, 'all')}`);
      const closureRef = ctx.doc(`attendanceClosures/${child.classId}_${dayKey}`);
      const out = await ctx.tx(async (t) => {
        const [hs, as_, cl] = await Promise.all([t.get(ref), t.get(attRef), t.get(closureRef)]);
        if (hs.exists) {
          const st = hs.data()!.state;
          if (st === 'received') return { ...hs.data(), id: ref.id, alreadyReceived: true };
          if (st === 'picked_up') fail('INVALID_STATE', 'Trẻ đã được trả trong ngày, không nhận lại bằng thao tác này.', { reason: 'already_picked_up' });
        }
        const data = {
          childId: child.id, classId: child.classId, campusId: child.campusId, dayKey, state: 'received', receivedAt: Timestamp.fromDate(at),
          receivedBy: ctx.uid, receivedByName: ctx.member?.displayName ?? ctx.uid, droppedBy, recordedAt: Timestamp.fromDate(ctx.now),
        };
        if (hs.exists) t.update(ref, { ...data, ...ctx.metaUpdate((hs.data()!.version as number) ?? 1) });
        else t.create(ref, { ...data, pickedAt: null, pickedBy: null, ...ctx.metaCreate() });
        let attendance = 'untouched';
        if (!cl.exists) {
          if (!as_.exists) {
            t.create(attRef, {
              childId: child.id, classId: child.classId, campusId: child.campusId, dayKey, session: 'all', status: 'present', arrivedAt: Timestamp.fromDate(at),
              droppedBy, note: null, healthNote: null, closed: false, markedBy: ctx.uid, markedByName: ctx.member?.displayName ?? ctx.uid, markedAt: Timestamp.fromDate(ctx.now),
              source: 'handover', ...ctx.metaCreate(),
            });
            attendance = 'created';
          } else if (!as_.data()!.closed && as_.data()!.status !== 'present') {
            t.update(attRef, { status: 'present', arrivedAt: Timestamp.fromDate(at), droppedBy, ...ctx.metaUpdate((as_.data()!.version as number) ?? 1) });
            attendance = 'updated';
          }
        }
        return { ...data, id: ref.id, attendance, alreadyReceived: false };
      });
      if (!out.alreadyReceived) {
        await ctx.audit({ action: 'handover.receive', collection: 'handovers', docId: ref.id, campusId: child.campusId, after: { dayKey, droppedBy } });
        void pushToUsers(ctx.orgId, await parentUidsOfChild(ctx, child.id, 'notify'), { type: 'handover', childId: child.id });
      }
      return out;
    },
  },

  'handover.pickup': {
    scope: 'org',
    idempotent: true,
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      ctx.require('handover.write', child.campusId);
      await requireClassAccess(ctx, child.campusId, child.classId ?? null);
      const campus = await campusOf(ctx, child.campusId);
      const dayKey = requireDay(b.dayKey, 'dayKey');
      checkDayNotFuture(ctx, campus, dayKey);
      const v = asObj(b.verification);
      const method = s(v.method);
      if (!(VERIFY_METHODS as readonly string[]).includes(method)) invalid({ 'verification.method': 'Chọn phương thức xác minh người đón.' });
      let paId = requireId(b.pickupPersonId, 'pickupPersonId');
      const at = pickTime(ctx, b.at);
      const hoRef = ctx.doc(`handovers/${hoId(child.id, dayKey)}`);
      let paRef = ctx.doc(`pickupAuthorizations/${paId}`);
      const res = await ctx.tx(async (t) => {
        let [hs, pa] = await Promise.all([t.get(hoRef), t.get(paRef)]);
        if (!pa.exists && !paId.startsWith('pa_')) { // tương thích: truyền id guardianLink
          const alt = ctx.doc(`pickupAuthorizations/pa_${paId}`);
          const altSnap = await t.get(alt);
          if (altSnap.exists) { pa = altSnap; paRef = alt; paId = alt.id; }
        }
        const block = (reason: string, message: string): never => fail('PRECONDITION', message, { reason });
        if (!hs.exists || hs.data()!.state === 'not_received') block('not_received', 'Trẻ chưa được nhà trường nhận nên chưa thể trả. Hãy xử lý bổ sung theo quy trình.');
        if (hs.data()!.state === 'picked_up') block('already_picked_up', 'Trẻ đã được trả trước đó, không xác nhận lặp.');
        if (!pa.exists) block('authorization_not_found', 'Không tìm thấy người đón trong danh sách được phép.');
        const a = pa.data()!;
        if (a.childId !== child.id) block('authorization_wrong_child', 'Người đón không được phép đón trẻ này.');
        if (a.status === 'revoked') block('authorization_revoked', 'Ủy quyền đón đã bị thu hồi. Liên hệ quản lý.');
        if (a.status === 'pending') block('authorization_pending', 'Ủy quyền đang chờ nhà trường xác nhận.');
        if (a.status !== 'approved') block('authorization_rejected', 'Ủy quyền đón không được chấp thuận.');
        const today = dayKeyOf(at, campus.timezone || 'Asia/Ho_Chi_Minh');
        if (a.validFrom && a.validFrom > today) block('authorization_not_started', 'Ủy quyền đón chưa có hiệu lực.');
        if (a.validTo && a.validTo < today) block('authorization_expired', 'Ủy quyền đón đã hết hạn.');
        const hhmm = hhmmOf(at, campus.timezone || 'Asia/Ho_Chi_Minh');
        if (a.validFromTime && a.validFrom === today && hhmm < a.validFromTime) block('authorization_not_started', 'Ủy quyền đón chưa đến giờ hiệu lực.');
        if (a.validToTime && a.validTo === today && hhmm > a.validToTime) block('authorization_expired', 'Ủy quyền đón đã hết giờ hiệu lực.');
        const upd = {
          state: 'picked_up', pickedAt: Timestamp.fromDate(at), pickedBy: ctx.uid, pickedByName: ctx.member?.displayName ?? ctx.uid,
          pickupPersonId: pa.id, pickupPersonName: a.personName, pickupRelation: a.relation ?? null,
          verification: { method, note: s(v.note) || null, supportOnly: method === 'qr' || method === 'otp' },
          pickupRecordedAt: Timestamp.fromDate(ctx.now),
          ...ctx.metaUpdate((hs.data()!.version as number) ?? 1),
        };
        t.update(hoRef, upd);
        return { ...hs.data(), ...upd, id: hoRef.id };
      });
      await ctx.audit({
        action: 'handover.pickup', collection: 'handovers', docId: hoRef.id, campusId: child.campusId,
        before: { state: 'received' }, after: { state: 'picked_up', pickupPersonId: res.pickupPersonId, method },
      });
      void pushToUsers(ctx.orgId, await parentUidsOfChild(ctx, child.id, 'notify'), { type: 'handover', childId: child.id });
      return res;
    },
  },

  // ---------------------------------------------------------------- ủy quyền đón
  'pickupAuth.save': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = s(b.id);
      let existing: DocumentData | null = null;
      if (id) existing = await getOr404(ctx.doc(`pickupAuthorizations/${id}`), 'Ủy quyền đón');
      const child = await childOf(ctx, existing ? existing.childId : b.childId);
      const isParent = ctx.member?.kind === 'parent';
      if (isParent) {
        requireParentOf(ctx, child.id);
        if ((ctx.member as any).childPerms?.[child.id]?.pickup !== true) denied('Bạn không có quyền ủy quyền đón cho bé này.');
      } else ctx.require('children.write', child.campusId);
      if (existing) {
        if (existing.type === 'guardian') fail('INVALID_STATE', 'Người giám hộ được quản lý qua liên kết giám hộ, không sửa ở đây.');
        if (existing.status === 'revoked' || existing.status === 'rejected') fail('INVALID_STATE', 'Ủy quyền đã bị thu hồi hoặc từ chối. Hãy tạo ủy quyền mới.');
        if (isParent && existing.requestedBy !== ctx.uid) denied('Bạn chỉ sửa được ủy quyền do chính mình tạo.');
      }
      const personName = s(b.personName ?? existing?.personName);
      if (personName.length < 2) invalid({ personName: 'Nhập họ tên người đón.' });
      const relation = s(b.relation ?? existing?.relation);
      if (!relation) invalid({ relation: 'Nhập quan hệ với trẻ.' });
      const idLast4 = s(b.idNumberLast4 ?? existing?.idNumberLast4);
      if (idLast4 && !/^\w{3,6}$/.test(idLast4)) invalid({ idNumberLast4: 'Chỉ nhập 4 ký tự cuối giấy tờ.' });
      const campus = await campusOf(ctx, child.campusId);
      const today = todayOf(ctx, campus);
      const validFrom = b.validFrom !== undefined ? requireDay(b.validFrom, 'validFrom') : (existing?.validFrom ?? today);
      const validTo = b.validTo !== undefined ? requireDay(b.validTo, 'validTo') : existing?.validTo;
      if (!validTo) invalid({ validTo: 'Ủy quyền cần có ngày hết hạn.' });
      if (validTo < validFrom) invalid({ validTo: 'Ngày hết hạn phải từ ngày bắt đầu trở đi.' });
      if (validTo < today) invalid({ validTo: 'Ngày hết hạn đã qua.' });
      if (daysBetween(validFrom, validTo).length > 366) invalid({ validTo: 'Ủy quyền tối đa 1 năm.' });
      for (const k of ['validFromTime', 'validToTime'] as const) if (b[k] && !TIME_RE.test(s(b[k]))) invalid({ [k]: 'Giờ không hợp lệ (HH:mm).' });
      const data = {
        childId: child.id, campusId: child.campusId, personName, phone: s(b.phone ?? existing?.phone) || null, relation, idNumberLast4: idLast4 || null,
        idType: s(b.idType ?? existing?.idType) || null, validFrom, validTo,
        validFromTime: s(b.validFromTime ?? existing?.validFromTime) || null, validToTime: s(b.validToTime ?? existing?.validToTime) || null,
        note: s(b.note ?? existing?.note).slice(0, 500), type: 'delegate',
      };
      if (!existing) {
        const status = isParent ? 'pending' : 'approved';
        const extra = isParent ? {} : { approvedBy: ctx.uid, approvedAt: Timestamp.fromDate(ctx.now) };
        const nid = await createDoc(ctx, 'pickupAuthorizations', undefined, { ...data, status, requestedBy: ctx.uid, requestedByName: ctx.member?.displayName ?? ctx.uid, ...extra });
        await ctx.audit({ action: 'pickupAuth.save', collection: 'pickupAuthorizations', docId: nid, campusId: child.campusId, after: { personName, validFrom, validTo, status } });
        return { id: nid, ...data, status, version: 1 };
      }
      // sửa: phụ huynh sửa ủy quyền đã duyệt → quay về chờ duyệt
      const patch: Record<string, any> = { ...data };
      if (isParent && existing.status === 'approved') { patch.status = 'pending'; patch.approvedBy = null; }
      const { before, after } = await updateDoc(ctx, ctx.doc(`pickupAuthorizations/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'pickupAuth.save', collection: 'pickupAuthorizations', docId: id, campusId: child.campusId, before: { personName: before.personName, validTo: before.validTo, status: before.status }, after: { personName, validTo, status: after.status } });
      return { id, ...after };
    },
  },

  'pickupAuth.decide': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const pa = await getOr404(ctx.doc(`pickupAuthorizations/${id}`), 'Ủy quyền đón');
      ctx.require('children.write', pa.campusId);
      const decision = s(b.decision);
      if (decision !== 'approved' && decision !== 'rejected') invalid({ decision: 'Quyết định phải là approved hoặc rejected.' });
      if (pa.status === decision) return { id, status: decision, unchanged: true };
      if (pa.status !== 'pending') fail('INVALID_STATE', 'Ủy quyền không còn ở trạng thái chờ xác nhận.', { status: pa.status });
      if (decision === 'rejected' && !s(b.note)) invalid({ note: 'Vui lòng nhập lý do từ chối.' });
      if (decision === 'approved' && pa.validTo && pa.validTo < todayOf(ctx, await campusOf(ctx, pa.campusId))) invalid({ validTo: 'Ủy quyền đã quá hạn, không thể duyệt.' });
      const patch = decision === 'approved'
        ? { status: 'approved', approvedBy: ctx.uid, approvedAt: Timestamp.fromDate(ctx.now), decisionNote: s(b.note) || null }
        : { status: 'rejected', rejectedBy: ctx.uid, rejectedAt: Timestamp.fromDate(ctx.now), decisionNote: s(b.note) };
      const { after } = await updateDoc(ctx, ctx.doc(`pickupAuthorizations/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'pickupAuth.decide', collection: 'pickupAuthorizations', docId: id, campusId: pa.campusId, before: { status: 'pending' }, after: { status: decision }, reason: s(b.note) || undefined });
      if (pa.requestedBy) void pushToUsers(ctx.orgId, [pa.requestedBy], { type: 'pickupAuth', id });
      return { id, status: decision, version: after.version };
    },
  },

  'pickupAuth.revoke': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const pa = await getOr404(ctx.doc(`pickupAuthorizations/${id}`), 'Ủy quyền đón');
      const reason = s(b.reason);
      if (!reason) invalid({ reason: 'Vui lòng nhập lý do thu hồi.' });
      if (ctx.member?.kind === 'parent') {
        requireParentOf(ctx, pa.childId);
      } else ctx.require('children.write', pa.campusId);
      if (pa.type === 'guardian') fail('INVALID_STATE', 'Quyền đón của người giám hộ được thu hồi qua liên kết giám hộ (child.linkGuardian / child.unlinkGuardian).');
      if (pa.status === 'revoked') return { id, status: 'revoked', unchanged: true };
      const { after } = await updateDoc(ctx, ctx.doc(`pickupAuthorizations/${id}`), {
        status: 'revoked', revokedAt: Timestamp.fromDate(ctx.now), revokedBy: ctx.uid, revokeReason: reason,
      });
      await ctx.audit({ action: 'pickupAuth.revoke', collection: 'pickupAuthorizations', docId: id, campusId: pa.campusId, before: { status: pa.status }, after: { status: 'revoked' }, reason });
      return { id, status: 'revoked', version: after.version };
    },
  },

  // ---------------------------------------------------------------- đơn nghỉ
  'leave.submit': {
    scope: 'org',
    kinds: ['parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const childId = requireId(b.childId, 'childId');
      requireParentOf(ctx, childId);
      const child = await childOf(ctx, childId);
      if (!IN_SCHOOL.includes(child.status)) fail('INVALID_STATE', 'Bé hiện không ở trạng thái đang học.');
      const campus = await campusOf(ctx, child.campusId);
      const fromDay = requireDay(b.fromDay, 'fromDay');
      const toDay = requireDay(b.toDay ?? b.fromDay, 'toDay');
      if (toDay < fromDay) invalid({ toDay: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
      if (fromDay < todayOf(ctx, campus)) invalid({ fromDay: 'Không thể xin nghỉ cho ngày đã qua.' });
      if (daysBetween(fromDay, toDay).length > 60) invalid({ toDay: 'Một đơn nghỉ tối đa 60 ngày.' });
      const session = s(b.session) || 'all';
      if (!(SESSIONS as readonly string[]).includes(session)) invalid({ session: 'Buổi phải là all, am hoặc pm.' });
      const reasonId = s(b.reasonId);
      if (!reasonId) invalid({ reasonId: 'Chọn lý do nghỉ.' });
      const existing = (await ctx.col('leaveRequests').where('childId', '==', childId).get()).docs
        .filter((d) => ['pending', 'approved'].includes(d.data().status) && d.data().fromDay <= toDay && d.data().toDay >= fromDay);
      if (existing.length) fail('CONFLICT', 'Đã có đơn nghỉ trùng thời gian cho bé.', { leaveId: existing[0].id });
      const data = {
        childId, classId: child.classId ?? null, campusId: child.campusId, fromDay, toDay, session, reasonId, reasonText: s(b.reasonText) || null,
        note: s(b.note).slice(0, 500), status: 'pending', submittedAt: Timestamp.fromDate(ctx.now), submittedBy: ctx.uid,
        submittedByName: ctx.member?.displayName ?? ctx.uid, mealCancelled: null, mealCancelledDays: [],
      };
      const id = await createDoc(ctx, 'leaveRequests', undefined, data);
      await ctx.audit({ action: 'leave.submit', collection: 'leaveRequests', docId: id, campusId: child.campusId, after: { childId, fromDay, toDay, session } });
      return { id, ...data, version: 1 };
    },
  },

  'leave.decide': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const lv = await getOr404(ctx.doc(`leaveRequests/${id}`), 'Đơn xin nghỉ');
      ctx.require('leave.decide', lv.campusId);
      await requireClassAccess(ctx, lv.campusId, lv.classId ?? null);
      const decision = s(b.decision);
      if (decision !== 'approved' && decision !== 'rejected') invalid({ decision: 'Quyết định phải là approved hoặc rejected.' });
      if (lv.status === decision) return { id, status: decision, unchanged: true };
      if (lv.status !== 'pending') fail('INVALID_STATE', 'Đơn không còn ở trạng thái chờ duyệt.', { status: lv.status });
      if (decision === 'rejected' && !s(b.note)) invalid({ note: 'Vui lòng nhập lý do từ chối.' });
      const campus = await campusOf(ctx, lv.campusId);
      const tz = campus.timezone || 'Asia/Ho_Chi_Minh';
      const cutoff = campus.mealCutoff && TIME_RE.test(campus.mealCutoff) ? campus.mealCutoff : '08:30';
      const submitted = tsOf(lv.submittedAt) ?? ctx.now;
      const sDay = dayKeyOf(submitted, tz);
      const sTime = hhmmOf(submitted, tz);
      const days = daysBetween(lv.fromDay, lv.toDay);
      // Mốc chốt tính theo thời điểm GỬI đơn (submittedAt): gửi trước giờ chốt của ngày nghỉ thì hủy được suất ăn ngày đó.
      const mealCancelledDays = decision === 'approved' ? days.filter((d) => d > sDay || (d === sDay && sTime <= cutoff)) : [];
      const patch = {
        status: decision, decidedBy: ctx.uid, decidedByName: ctx.member?.displayName ?? ctx.uid, decidedAt: Timestamp.fromDate(ctx.now),
        decisionNote: s(b.note) || null, mealCancelled: mealCancelledDays.length > 0, mealCancelledDays, mealCutoffUsed: cutoff,
        affectsAttendance: false, // đơn nghỉ KHÔNG tự thay điểm danh thực tế
      };
      const { after } = await updateDoc(ctx, ctx.doc(`leaveRequests/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'leave.decide', collection: 'leaveRequests', docId: id, campusId: lv.campusId, before: { status: 'pending' }, after: { status: decision, mealCancelledDays }, reason: s(b.note) || undefined });
      if (lv.submittedBy) void pushToUsers(ctx.orgId, [lv.submittedBy], { type: 'leave', id });
      return { id, status: decision, mealCancelled: patch.mealCancelled, mealCancelledDays, version: after.version };
    },
  },

  'leave.cancel': {
    scope: 'org',
    kinds: ['owner', 'staff', 'parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const lv = await getOr404(ctx.doc(`leaveRequests/${id}`), 'Đơn xin nghỉ');
      if (ctx.member?.kind === 'parent') requireParentOf(ctx, lv.childId);
      else ctx.require('leave.decide', lv.campusId);
      if (lv.status === 'cancelled') return { id, status: 'cancelled', unchanged: true };
      const campus = await campusOf(ctx, lv.campusId);
      const today = todayOf(ctx, campus);
      if (!['pending', 'approved'].includes(lv.status)) fail('INVALID_STATE', 'Đơn đã xử lý, không hủy được.', { status: lv.status });
      if (lv.status === 'approved' && lv.fromDay <= today) fail('INVALID_STATE', 'Đơn đã bắt đầu hiệu lực, hãy liên hệ nhà trường để điều chỉnh.');
      const { after } = await updateDoc(ctx, ctx.doc(`leaveRequests/${id}`), {
        status: 'cancelled', cancelledAt: Timestamp.fromDate(ctx.now), cancelledBy: ctx.uid, cancelReason: s(b.reason) || null, mealCancelled: false, mealCancelledDays: [],
      });
      await ctx.audit({ action: 'leave.cancel', collection: 'leaveRequests', docId: id, campusId: lv.campusId, before: { status: lv.status, mealCancelledDays: lv.mealCancelledDays ?? [] }, after: { status: 'cancelled' }, reason: s(b.reason) || undefined });
      return { id, status: 'cancelled', version: after.version };
    },
  },
};

/** `at` do client gửi chỉ được chấp nhận trong khoảng hợp lý quanh giờ máy chủ; ngoài khoảng → dùng giờ máy chủ. */
function pickTime(ctx: Ctx, v: unknown): Date {
  if (!v) return ctx.now;
  const d = parseWhen(v, 'at');
  if (!d) return ctx.now;
  const diff = d.getTime() - ctx.now.getTime();
  if (diff > 5 * 60_000 || diff < -18 * 3600_000) return ctx.now;
  return d;
}

export type { ChildDoc };
