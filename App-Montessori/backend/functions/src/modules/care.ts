import type { DocumentData } from 'firebase-admin/firestore';
import { Timestamp, db } from '../core/firebase';
import { denied, fail, invalid } from '../core/errors';
import { createDoc, getOr404, updateDoc } from '../core/store';
import { validate, Schema, TIME_RE } from '../core/validate';
import { hasPerm } from '../core/permissions';
import type { ActionMap, Ctx } from '../core/types';
import {
  asArr, asObj, campusOf, chunk, ChildDoc, childOf, classOf, enrolledOn, parentUidsOfChild, parseWhen, pushToUsers, requireClassAccess,
  requireDay, requireId, requireParentOf, s, todayOf,
} from './util';

const IN_SCHOOL = ['active', 'trial', 'on_leave'];
const dlId = (childId: string, dayKey: string) => `${childId}_${dayKey}`;

function checkPhotoPaths(ctx: Ctx, child: ChildDoc, paths: string[]): void {
  if (!paths.length) return;
  const prefix = `orgs/${ctx.orgId}/campuses/${child.campusId}/`;
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith(prefix) || p.includes('..')) invalid({ photoPaths: 'Đường dẫn ảnh không hợp lệ hoặc thuộc cơ sở khác.' });
  }
  if (child.photoConsent !== true) fail('PRECONDITION', 'Phụ huynh chưa đồng ý sử dụng hình ảnh của bé nên không thể đính kèm ảnh.', { reason: 'no_photo_consent' });
}

const logSchema: Schema = {
  meals: { t: 'array', max: 12, of: { t: 'object' } },
  sleep: { t: 'array', max: 8, of: { t: 'object' } },
  hygiene: { t: 'object' },
  mood: { t: 'string', max: 40 },
  activities: { t: 'array', max: 20, of: { t: 'string', max: 200 } },
  note: { t: 'string', max: 1500 },
  photoPaths: { t: 'array', max: 10, of: { t: 'string', max: 400 } },
};

export const actions: ActionMap = {
  // ---------------------------------------------------------------- nhật ký
  'dailyLog.save': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      ctx.require('care.write', child.campusId);
      await requireClassAccess(ctx, child.campusId, child.classId ?? null);
      if (!IN_SCHOOL.includes(child.status) || !child.classId) fail('INVALID_STATE', 'Bé không ở trạng thái đang học nên không ghi nhật ký.');
      const campus = await campusOf(ctx, child.campusId);
      const dayKey = requireDay(b.dayKey, 'dayKey');
      if (dayKey > todayOf(ctx, campus)) invalid({ dayKey: 'Không thể ghi nhật ký cho ngày ở tương lai.' });
      if (!(await enrolledOn(ctx, child.id, child.classId, dayKey))) invalid({ dayKey: 'Bé không thuộc lớp trong ngày này.' });
      const d = validate<Record<string, any>>(b, logSchema, { partial: true });
      for (const m of asArr<any>(d.sleep)) {
        for (const k of ['from', 'to']) if (m?.[k] && !TIME_RE.test(String(m[k]))) invalid({ sleep: 'Giờ ngủ không hợp lệ (HH:mm).' });
      }
      if (d.photoPaths) checkPhotoPaths(ctx, child, d.photoPaths);
      const ref = ctx.doc(`dailyLogs/${dlId(child.id, dayKey)}`);
      const cur = await ref.get();
      if (!cur.exists) {
        const data = { ...d, childId: child.id, classId: child.classId, campusId: child.campusId, dayKey, status: 'draft', revision: 1, authorUid: ctx.uid, authorName: ctx.member?.displayName ?? ctx.uid };
        await createDoc(ctx, 'dailyLogs', ref.id, data);
        await ctx.audit({ action: 'dailyLog.save', collection: 'dailyLogs', docId: ref.id, campusId: child.campusId, after: { dayKey, status: 'draft' } });
        return { id: ref.id, ...data, version: 1 };
      }
      const prev = cur.data()!;
      const patch = { ...d, revision: ((prev.revision as number) ?? 1) + 1, lastEditorUid: ctx.uid, ...(prev.status === 'published' ? { editedAfterPublish: true } : {}) };
      const { after } = await updateDoc(ctx, ref, patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'dailyLog.save', collection: 'dailyLogs', docId: ref.id, campusId: child.campusId, before: { status: prev.status, revision: prev.revision }, after: { status: after.status, revision: patch.revision } });
      return { id: ref.id, ...after };
    },
  },

  'dailyLog.publish': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const cls = await classOf(ctx, b.classId);
      ctx.require('care.publish', cls.campusId);
      const dayKey = requireDay(b.dayKey, 'dayKey');
      const filter = asArr<string>(b.childIds).map(s).filter(Boolean);
      const q = await ctx.col('dailyLogs').where('classId', '==', cls.id).where('dayKey', '==', dayKey).get();
      const published: string[] = [];
      const skipped: Array<{ childId: string; reason: string }> = [];
      let already = 0;
      const targets = q.docs.filter((d) => !filter.length || filter.includes(d.data().childId));
      for (const f of filter) if (!targets.some((d) => d.data().childId === f)) skipped.push({ childId: f, reason: 'Chưa có nhật ký cho bé trong ngày này.' });
      const nowTs = Timestamp.fromDate(ctx.now);
      const ok: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const d of targets) {
        const l = d.data();
        if (l.status === 'published') { already++; continue; }
        if (l.dayKey !== dayKey || l.classId !== cls.id) { skipped.push({ childId: l.childId, reason: 'Nhật ký không đúng ngày/lớp.' }); continue; }
        const cs = await ctx.doc(`children/${l.childId}`).get();
        if (!cs.exists || cs.data()!.campusId !== cls.campusId) { skipped.push({ childId: l.childId, reason: 'Hồ sơ trẻ không hợp lệ.' }); continue; }
        if (!(await enrolledOn(ctx, l.childId, cls.id, dayKey))) { skipped.push({ childId: l.childId, reason: 'Bé không thuộc lớp trong ngày này.' }); continue; }
        if (asArr(l.photoPaths).length && cs.data()!.photoConsent !== true) { skipped.push({ childId: l.childId, reason: 'Có ảnh nhưng bé chưa có đồng ý sử dụng hình ảnh.' }); continue; }
        ok.push(d);
      }
      for (const part of chunk(ok, 400)) {
        const batch = db.batch();
        part.forEach((d) => batch.update(d.ref, { status: 'published', publishedAt: nowTs, publishedBy: ctx.uid, updatedAt: nowTs, updatedBy: ctx.uid, version: (d.data().version ?? 1) + 1 }));
        await batch.commit();
      }
      for (const d of ok) published.push(d.data().childId);
      await ctx.audit({ action: 'dailyLog.publish', collection: 'dailyLogs', docId: `${cls.id}_${dayKey}`, campusId: cls.campusId, after: { published: published.length, skipped: skipped.length } });
      if (published.length) {
        const uids: string[] = [];
        for (const cid of published) uids.push(...(await parentUidsOfChild(ctx, cid, 'notify')));
        void pushToUsers(ctx.orgId, uids, { type: 'dailyLog' });
      }
      return { classId: cls.id, dayKey, published, skipped, alreadyPublished: already };
    },
  },

  // ---------------------------------------------------------------- sức khỏe
  'health.record': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      if (!ctx.can('care.write', child.campusId) && !ctx.can('medication.write', child.campusId)) denied();
      await requireClassAccess(ctx, child.campusId, child.classId ?? null);
      const d = validate<Record<string, any>>(b, {
        heightCm: { t: 'number', req: true, min: 30, max: 200 }, weightKg: { t: 'number', req: true, min: 2, max: 80 },
        measuredOn: { t: 'day', req: true }, note: { t: 'string', max: 500 },
      });
      const campus = await campusOf(ctx, child.campusId);
      if (d.measuredOn > todayOf(ctx, campus)) invalid({ measuredOn: 'Ngày đo không được ở tương lai.' });
      const bmi = Math.round((d.weightKg / ((d.heightCm / 100) ** 2)) * 10) / 10;
      const id = await createDoc(ctx, 'healthRecords', undefined, { ...d, bmi, childId: child.id, campusId: child.campusId, recordedBy: ctx.uid, recordedByName: ctx.member?.displayName ?? ctx.uid });
      await ctx.audit({ action: 'health.record', collection: 'healthRecords', docId: id, campusId: child.campusId, after: { measuredOn: d.measuredOn } });
      return { id, ...d, bmi, childId: child.id, campusId: child.campusId };
    },
  },

  'medication.request': {
    scope: 'org',
    kinds: ['parent'],
    handler: async (ctx, p) => {
      const b = asObj(p);
      const childId = requireId(b.childId, 'childId');
      requireParentOf(ctx, childId);
      const child = await childOf(ctx, childId);
      if (!IN_SCHOOL.includes(child.status)) fail('INVALID_STATE', 'Bé hiện không ở trạng thái đang học.');
      const campus = await campusOf(ctx, child.campusId);
      const d = validate<Record<string, any>>(b, {
        medicineName: { t: 'string', req: true, min: 2, max: 120 },
        dose: { t: 'string', req: true, min: 1, max: 60 },
        times: { t: 'array', req: true, max: 8, of: { t: 'time' } },
        fromDay: { t: 'day', req: true },
        toDay: { t: 'day', req: true },
        instructions: { t: 'string', req: true, min: 3, max: 500 },
        reason: { t: 'string', max: 300 },
        storage: { t: 'string', max: 200 },
        photoPath: { t: 'string', max: 400 },
      });
      if (!asArr(d.times).length) invalid({ times: 'Nhập ít nhất một giờ uống thuốc.' });
      if (d.toDay < d.fromDay) invalid({ toDay: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
      if (d.toDay < todayOf(ctx, campus)) invalid({ toDay: 'Ngày kết thúc đã qua.' });
      if (d.photoPath) {
        const prefix = `orgs/${ctx.orgId}/campuses/${child.campusId}/`;
        if (!d.photoPath.startsWith(prefix) || d.photoPath.includes('..')) invalid({ photoPath: 'Đường dẫn ảnh không hợp lệ.' });
      }
      const data = { ...d, childId, classId: child.classId ?? null, campusId: child.campusId, status: 'pending', requestedBy: ctx.uid, requestedByName: ctx.member?.displayName ?? ctx.uid };
      const id = await createDoc(ctx, 'medicationRequests', undefined, data);
      await ctx.audit({ action: 'medication.request', collection: 'medicationRequests', docId: id, campusId: child.campusId, after: { childId, fromDay: d.fromDay, toDay: d.toDay } });
      return { id, ...data, version: 1 };
    },
  },

  'medication.decide': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const rq = await getOr404(ctx.doc(`medicationRequests/${id}`), 'Yêu cầu thuốc');
      ctx.require('medication.write', rq.campusId);
      await requireClassAccess(ctx, rq.campusId, rq.classId ?? null);
      const decision = s(b.decision);
      if (!['received', 'rejected', 'paused'].includes(decision)) invalid({ decision: 'Quyết định phải là received, rejected hoặc paused.' });
      const reason = s(b.reason);
      if ((decision === 'rejected' || decision === 'paused') && !reason) invalid({ reason: 'Vui lòng nhập lý do.' });
      if (rq.status === decision) return { id, status: decision, unchanged: true };
      const allowed: Record<string, string[]> = { pending: ['received', 'rejected'], received: ['paused'], paused: ['received'] };
      if (!(allowed[rq.status] ?? []).includes(decision)) fail('INVALID_STATE', `Không thể chuyển từ "${rq.status}" sang "${decision}".`, { status: rq.status });
      const patch: Record<string, any> = { status: decision, decisionReason: reason || null, decidedBy: ctx.uid, decidedByName: ctx.member?.displayName ?? ctx.uid, decidedAt: Timestamp.fromDate(ctx.now) };
      if (decision === 'received' && rq.status === 'pending') {
        patch.receivedAt = Timestamp.fromDate(ctx.now);
        patch.receivedBy = ctx.uid;
      }
      if (s(b.assigneeUid)) {
        const au = await ctx.doc(`members/${s(b.assigneeUid)}`).get();
        if (!au.exists || au.data()!.status !== 'active' || !hasPerm(au.data()!.permsByCampus, 'medication.write', rq.campusId)) invalid({ assigneeUid: 'Người được giao không có quyền thực hiện thuốc tại cơ sở này.' });
        patch.assigneeUid = s(b.assigneeUid);
        patch.assigneeName = au.data()!.displayName;
      }
      const { after } = await updateDoc(ctx, ctx.doc(`medicationRequests/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'medication.decide', collection: 'medicationRequests', docId: id, campusId: rq.campusId, before: { status: rq.status }, after: { status: decision }, reason: reason || undefined });
      if (rq.requestedBy) void pushToUsers(ctx.orgId, [rq.requestedBy], { type: 'medication', id });
      return { id, status: decision, version: after.version };
    },
  },

  'medication.administer': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const requestId = requireId(b.requestId, 'requestId');
      const rq = await getOr404(ctx.doc(`medicationRequests/${requestId}`), 'Yêu cầu thuốc');
      ctx.require('medication.write', rq.campusId);
      await requireClassAccess(ctx, rq.campusId, rq.classId ?? null);
      if (rq.status !== 'received') fail('INVALID_STATE', 'Chỉ ghi nhận cho yêu cầu thuốc đã được nhận (không bị từ chối/tạm dừng).', { status: rq.status });
      const dose = s(b.dose);
      if (!dose) invalid({ dose: 'Bắt buộc nhập liều thực tế đã cho dùng (không suy đoán).' });
      const result = s(b.result);
      if (!['given', 'partial', 'refused', 'vomited', 'missed'].includes(result)) invalid({ result: 'Kết quả phải là given, partial, refused, vomited hoặc missed.' });
      const at = parseWhen(b.at, 'at') ?? ctx.now;
      if (at.getTime() - ctx.now.getTime() > 5 * 60_000) invalid({ at: 'Giờ dùng thuốc không được ở tương lai.' });
      const campus = await campusOf(ctx, rq.campusId);
      const dayAt = new Intl.DateTimeFormat('en-CA', { timeZone: campus.timezone || 'Asia/Ho_Chi_Minh' }).format(at);
      if (dayAt < rq.fromDay || dayAt > rq.toDay) fail('PRECONDITION', 'Ngày dùng thuốc nằm ngoài thời gian phụ huynh yêu cầu.', { fromDay: rq.fromDay, toDay: rq.toDay });
      const doseDiffers = dose.replace(/\s+/g, '').toLowerCase() !== String(rq.dose).replace(/\s+/g, '').toLowerCase();
      if (doseDiffers && !s(b.note)) invalid({ note: 'Liều khác với yêu cầu của phụ huynh, vui lòng ghi chú lý do.' });
      const dup = (await ctx.col('medicationAdmins').where('requestId', '==', requestId).get()).docs
        .find((d) => Math.abs((d.data().at as Timestamp).toMillis() - at.getTime()) < 60_000);
      if (dup) fail('CONFLICT', 'Lần dùng thuốc này đã được ghi nhận.', { id: dup.id });
      const data = {
        requestId, childId: rq.childId, campusId: rq.campusId, classId: rq.classId ?? null, medicineName: rq.medicineName, requestedDose: rq.dose, dose, doseDiffers,
        at: Timestamp.fromDate(at), result, note: s(b.note).slice(0, 500) || null, administeredBy: ctx.uid, administeredByName: ctx.member?.displayName ?? ctx.uid,
      };
      const id = await createDoc(ctx, 'medicationAdmins', undefined, data);
      await ctx.audit({ action: 'medication.administer', collection: 'medicationAdmins', docId: id, campusId: rq.campusId, after: { requestId, dose, result } });
      return { id, ...data, version: 1 };
    },
  },

  // ---------------------------------------------------------------- sự cố
  'incident.save': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = s(b.id);
      let existing: DocumentData | null = null;
      if (id) existing = await getOr404(ctx.doc(`incidents/${id}`), 'Sự cố');
      let child: ChildDoc | null = null;
      const childId = s(b.childId ?? existing?.childId);
      if (childId) child = await childOf(ctx, childId);
      const campusId = existing ? (existing.campusId as string) : child ? child.campusId : (await campusOf(ctx, s(b.campusId) || s(ctx.campusId))).id;
      ctx.require('incident.write', campusId);
      if (child) {
        if (child.campusId !== campusId) invalid({ childId: 'Trẻ không thuộc cơ sở này.' });
        await requireClassAccess(ctx, campusId, child.classId ?? null);
      }
      if (existing?.status === 'closed') fail('INVALID_STATE', 'Sự cố đã đóng, không thể sửa.');
      const d = validate<Record<string, any>>(b, {
        occurredAt: { t: 'string', req: true, max: 40 }, type: { t: 'string', req: true, max: 60 },
        severity: { t: 'string', req: true, oneOf: ['minor', 'moderate', 'serious'] }, location: { t: 'string', max: 120 },
        description: { t: 'string', req: true, min: 5, max: 3000 }, firstAid: { t: 'string', max: 2000 },
        contactedPersons: { t: 'array', max: 20, of: { t: 'object' } }, ownerUid: { t: 'string', max: 128 }, outcome: { t: 'string', max: 2000 },
        shareWithParent: { t: 'bool' }, restricted: { t: 'bool' }, viewerUids: { t: 'array', max: 50, of: { t: 'string', max: 128 } },
      }, { partial: !!existing });
      if (d.occurredAt) {
        const w = parseWhen(d.occurredAt, 'occurredAt')!;
        if (w.getTime() - ctx.now.getTime() > 5 * 60_000) invalid({ occurredAt: 'Thời điểm xảy ra không được ở tương lai.' });
        d.occurredAt = Timestamp.fromDate(w);
      }
      if (d.shareWithParent === true && !ctx.can('children.write', campusId)) denied('Chỉ quản lý mới được chia sẻ hồ sơ sự cố cho phụ huynh.');
      if (d.ownerUid) {
        const om = await ctx.doc(`members/${d.ownerUid}`).get();
        if (!om.exists || om.data()!.kind === 'parent') invalid({ ownerUid: 'Người phụ trách không hợp lệ.' });
      }
      const viewers = new Set<string>([...(d.viewerUids ?? existing?.viewerUids ?? []), existing?.createdBy ?? ctx.uid, ctx.uid]);
      if (d.ownerUid ?? existing?.ownerUid) viewers.add(d.ownerUid ?? existing?.ownerUid);
      if (!existing) {
        const data = { ...d, viewerUids: [...viewers], restricted: d.restricted ?? true, shareWithParent: d.shareWithParent ?? false, childId: child?.id ?? null, classId: child?.classId ?? null, campusId, status: 'open', reportedBy: ctx.uid, reportedByName: ctx.member?.displayName ?? ctx.uid };
        const nid = await createDoc(ctx, 'incidents', undefined, data);
        await ctx.audit({ action: 'incident.save', collection: 'incidents', docId: nid, campusId, after: { type: d.type, severity: d.severity, childId: child?.id ?? null } });
        return { id: nid, ...data, version: 1 };
      }
      const { before, after } = await updateDoc(ctx, ctx.doc(`incidents/${id}`), { ...d, viewerUids: [...viewers] }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'incident.save', collection: 'incidents', docId: id, campusId, before: { severity: before.severity, shareWithParent: before.shareWithParent }, after: { severity: after.severity, shareWithParent: after.shareWithParent } });
      return { id, ...after };
    },
  },

  'incident.close': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const inc = await getOr404(ctx.doc(`incidents/${id}`), 'Sự cố');
      ctx.require('incident.write', inc.campusId);
      if (inc.childId) { const c = await childOf(ctx, inc.childId); await requireClassAccess(ctx, inc.campusId, c.classId ?? null); }
      if (inc.status === 'closed') return { id, status: 'closed', unchanged: true };
      const outcome = s(b.outcome) || (inc.outcome as string | undefined) || '';
      if (!outcome) invalid({ outcome: 'Vui lòng ghi kết quả xử lý trước khi đóng.' });
      const { after } = await updateDoc(ctx, ctx.doc(`incidents/${id}`), {
        status: 'closed', outcome, closeNote: s(b.note) || null, closedBy: ctx.uid, closedByName: ctx.member?.displayName ?? ctx.uid, closedAt: Timestamp.fromDate(ctx.now),
      }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'incident.close', collection: 'incidents', docId: id, campusId: inc.campusId, before: { status: inc.status }, after: { status: 'closed', outcome } });
      return { id, status: 'closed', version: after.version };
    },
  },
};
