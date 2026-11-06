import type { DocumentData } from 'firebase-admin/firestore';
import { FieldValue, Timestamp, db } from '../core/firebase';
import { denied, fail, invalid } from '../core/errors';
import { createApproval, registerApprovalHandler, ApprovalDoc } from '../core/approvals';
import { createDoc, getOr404, updateDoc } from '../core/store';
import { validate, Schema } from '../core/validate';
import { hasPerm } from '../core/permissions';
import type { ActionMap, Ctx } from '../core/types';
import { decideApprovalCore, registerCancelHook } from './approval-core';
import { linkGuardianCore, unlinkGuardianCore } from './people';
import {
  addDays, asArr, asObj, campusOf, chunk, ChildDoc, childOf, classOf, normPhone, parseWhen, requireDay, requireId, s, todayOf, tsOf,
} from './util';

export const LEAD_STATUSES = ['new', 'contacted', 'tour_scheduled', 'trial', 'documents', 'approved', 'enrolled', 'lost'] as const;
export const CHILD_STATUSES = ['pending', 'active', 'trial', 'on_leave', 'withdrawn', 'archived'] as const;
const IN_SCHOOL = ['active', 'trial', 'on_leave'];

// ------------------------------------------------------------------ nội bộ: lớp & sĩ số

export async function activeEnrollmentCount(ctx: Ctx, classId: string): Promise<number> {
  return (await ctx.col('enrollments').where('classId', '==', classId).where('status', '==', 'active').count().get()).data().count;
}

export async function syncEnrolledCount(ctx: Ctx, classId: string | null | undefined): Promise<void> {
  if (!classId) return;
  const n = await activeEnrollmentCount(ctx, classId);
  await ctx.doc(`classes/${classId}`).update({ enrolledCount: n, updatedAt: Timestamp.fromDate(ctx.now) }).catch(() => undefined);
}

async function freeSeatSuggestions(ctx: Ctx, campusId: string, excludeClassId?: string) {
  const classes = (await ctx.col('classes').where('campusId', '==', campusId).get()).docs
    .filter((d) => !d.data().archived && d.data().status !== 'closed' && d.id !== excludeClassId);
  const out: Array<{ classId: string; name: string; capacity: number; enrolled: number; free: number }> = [];
  for (const c of classes) {
    const enrolled = await activeEnrollmentCount(ctx, c.id);
    const cap = (c.data().capacity as number) ?? 0;
    if (cap - enrolled > 0) out.push({ classId: c.id, name: c.data().name, capacity: cap, enrolled, free: cap - enrolled });
  }
  return out;
}

async function requireOpenClass(ctx: Ctx, classId: string) {
  const cls = await classOf(ctx, classId);
  if (cls.archived === true || cls.status === 'closed') fail('INVALID_STATE', 'Lớp đã đóng hoặc đã lưu trữ.');
  return cls;
}

// ------------------------------------------------------------------ nội bộ: hồ sơ trẻ

const childSchema: Schema = {
  code: { t: 'string', min: 2, max: 20, pattern: /^[A-Za-z0-9_-]+$/ },
  fullName: { t: 'string', req: true, min: 2, max: 120 },
  nickname: { t: 'string', max: 60 },
  dob: { t: 'day', req: true },
  gender: { t: 'string', oneOf: ['male', 'female', 'other'] },
  address: { t: 'string', max: 300 },
  photoConsent: { t: 'bool' },
  avatarPath: { t: 'string', max: 300 },
  notes: { t: 'string', max: 1000 },
  missingDocuments: { t: 'array', max: 30, of: { t: 'string', max: 100 } },
};

const healthSchema: Schema = {
  allergies: { t: 'array', max: 30, of: { t: 'string', max: 100 } },
  conditions: { t: 'array', max: 30, of: { t: 'string', max: 200 } },
  dietNote: { t: 'string', max: 500 },
  bloodType: { t: 'string', max: 5 },
  doctor: { t: 'string', max: 120 },
  hospital: { t: 'string', max: 120 },
  emergencyContact: { t: 'object' },
  notes: { t: 'string', max: 1000 },
};

function normName(v: string): string {
  return v.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function checkDob(ctx: Ctx, dob: string): void {
  const today = todayOf(ctx);
  if (dob > today) invalid({ dob: 'Ngày sinh không được ở tương lai.' });
  if (dob < addDays(today, -365 * 15)) invalid({ dob: 'Ngày sinh không hợp lý đối với trẻ mầm non.' });
}

async function findDuplicates(ctx: Ctx, fullName: string, dob: string, exceptId?: string) {
  const snap = await ctx.col('children').where('dob', '==', dob).get();
  return snap.docs.filter((d) => d.id !== exceptId && normName(d.data().fullName ?? '') === normName(fullName) && d.data().status !== 'archived')
    .map((d) => ({ id: d.id, code: d.data().code, fullName: d.data().fullName, campusId: d.data().campusId, status: d.data().status }));
}

async function writeHealth(ctx: Ctx, childId: string, campusId: string, rawHealth: unknown): Promise<void> {
  const h = validate<Record<string, any>>(asObj(rawHealth), healthSchema, { partial: true });
  if (!Object.keys(h).length) return;
  const ref = ctx.doc(`children/${childId}/private/health`);
  const snap = await ref.get();
  const before = snap.exists ? snap.data() : null;
  if (snap.exists) await ref.update({ ...h, ...ctx.metaUpdate((before!.version as number) ?? 1) });
  else await ref.create({ ...h, childId, campusId, ...ctx.metaCreate() });
  await ctx.audit({ action: 'child.health.write', collection: 'children/private', docId: `${childId}/health`, campusId, before: before ? '[đã có]' : null, after: Object.keys(h) });
}

/** Mã tự sinh MN001... bằng bộ đếm trong transaction; trùng mã báo lỗi. */
async function createChildDoc(
  ctx: Ctx, campusId: string, data: Record<string, any>, extra: Record<string, any>, force = false,
): Promise<{ id: string; code: string }> {
  const ref = ctx.col('children').doc();
  const counterRef = ctx.doc('counters/childCode');
  const code = await ctx.tx(async (t) => {
    let chosen = s(data.code).toUpperCase();
    let next: number | undefined;
    if (!chosen) {
      const cs = await t.get(counterRef);
      let n = (cs.exists ? (cs.data()!.value as number) : 0) + 1;
      for (let i = 0; i < 100; i++, n++) {
        const probe = `MN${String(n).padStart(3, '0')}`;
        if (!(await t.get(ctx.doc(`childCodes/${probe}`))).exists) { chosen = probe; next = n; break; }
      }
      if (!chosen) fail('INTERNAL', 'Không sinh được mã trẻ. Vui lòng thử lại.');
    } else if ((await t.get(ctx.doc(`childCodes/${chosen}`))).exists) {
      invalid({ code: `Mã trẻ ${chosen} đã tồn tại.` }, 'Dữ liệu bị trùng.');
    }
    if (next !== undefined) t.set(counterRef, { value: next, updatedAt: Timestamp.fromDate(ctx.now) });
    t.create(ctx.doc(`childCodes/${chosen}`), { childId: ref.id, campusId, createdAt: Timestamp.fromDate(ctx.now) });
    t.create(ref, { ...data, code: chosen, campusId, ...extra, ...ctx.metaCreate() });
    return chosen;
  });
  void force;
  return { id: ref.id, code };
}

// ------------------------------------------------------------------ nội bộ: nhập học

interface EnrollParams {
  existingChildId?: string;
  childData: Record<string, any>;
  health?: unknown;
  classId: string;
  startDate: string;
  feePlanId?: string;
  guardians: Array<{ guardian: any; perms: any }>;
  leadId?: string;
  childStatus?: string;
}

async function performEnroll(ctx: Ctx, p: EnrollParams, force: boolean) {
  const cls = await requireOpenClass(ctx, p.classId);
  const campusId = cls.campusId;
  const classRef = ctx.doc(`classes/${cls.id}`);
  const enrRef = ctx.col('enrollments').doc();
  let child: { id: string; code: string };
  const status = p.childStatus && ['active', 'trial'].includes(p.childStatus) ? p.childStatus : 'active';

  if (p.existingChildId) {
    const c = await childOf(ctx, p.existingChildId);
    if (c.campusId !== campusId) fail('INVALID_STATE', 'Trẻ thuộc cơ sở khác. Hãy dùng chức năng chuyển cơ sở.');
    if (c.classId && IN_SCHOOL.includes(c.status)) fail('CONFLICT', 'Trẻ đã được xếp lớp. Hãy dùng chức năng chuyển lớp.');
    child = { id: c.id, code: c.code as string };
  } else {
    child = { id: '', code: '' };
  }

  const childRef = p.existingChildId ? ctx.doc(`children/${p.existingChildId}`) : ctx.col('children').doc();
  const counterRef = ctx.doc('counters/childCode');
  await ctx.tx(async (t) => {
    const cs = await t.get(classRef);
    if (!cs.exists) fail('NOT_FOUND', 'Lớp học không tồn tại.');
    const cap = (cs.data()!.capacity as number) ?? 0;
    const q = await t.get(ctx.col('enrollments').where('classId', '==', cls.id).where('status', '==', 'active'));
    if (!force && q.size >= cap) {
      fail('LIMIT', `Lớp đã đủ sĩ số (${q.size}/${cap}).`, { capacity: cap, enrolled: q.size, classId: cls.id });
    }
    if (!p.existingChildId) {
      let chosen = s(p.childData.code).toUpperCase();
      let next: number | undefined;
      if (!chosen) {
        const cn = await t.get(counterRef);
        let n = (cn.exists ? (cn.data()!.value as number) : 0) + 1;
        for (let i = 0; i < 100; i++, n++) {
          const probe = `MN${String(n).padStart(3, '0')}`;
          if (!(await t.get(ctx.doc(`childCodes/${probe}`))).exists) { chosen = probe; next = n; break; }
        }
        if (!chosen) fail('INTERNAL', 'Không sinh được mã trẻ. Vui lòng thử lại.');
      } else if ((await t.get(ctx.doc(`childCodes/${chosen}`))).exists) {
        invalid({ code: `Mã trẻ ${chosen} đã tồn tại.` }, 'Dữ liệu bị trùng.');
      }
      if (next !== undefined) t.set(counterRef, { value: next, updatedAt: Timestamp.fromDate(ctx.now) });
      t.create(ctx.doc(`childCodes/${chosen}`), { childId: childRef.id, campusId, createdAt: Timestamp.fromDate(ctx.now) });
      t.create(childRef, {
        ...p.childData, code: chosen, campusId, classId: cls.id, status, enrolledAt: p.startDate, leadId: p.leadId ?? null,
        archived: false, ...ctx.metaCreate(),
      });
      child = { id: childRef.id, code: chosen };
    } else {
      const cur = await t.get(childRef);
      t.update(childRef, { classId: cls.id, status, enrolledAt: p.startDate, ...ctx.metaUpdate((cur.data()!.version as number) ?? 1) });
    }
    t.create(enrRef, {
      childId: childRef.id, classId: cls.id, campusId, startDate: p.startDate, endDate: null, status: 'active',
      feePlanId: p.feePlanId ?? null, source: 'enroll', exception: force && q.size >= cap, ...ctx.metaCreate(),
    });
    t.update(classRef, { enrolledCount: q.size + 1 });
  });

  if (p.health) await writeHealth(ctx, child.id, campusId, p.health);
  const guardians: any[] = [];
  const full = await childOf(ctx, child.id);
  for (const g of p.guardians) guardians.push(await linkGuardianCore(ctx, full, g.guardian, g.perms));
  if (p.leadId) {
    const lr = ctx.doc(`leads/${p.leadId}`);
    const ls = await lr.get();
    if (ls.exists) {
      await lr.update({
        status: 'enrolled', enrolledChildId: child.id, enrolledAt: Timestamp.fromDate(ctx.now),
        statusHistory: FieldValue.arrayUnion({ status: 'enrolled', at: Timestamp.fromDate(ctx.now), by: ctx.uid, note: 'Nhập học' }),
        ...ctx.metaUpdate((ls.data()!.version as number) ?? 1),
      });
    }
  }
  await ctx.audit({
    action: 'lead.enroll', collection: 'enrollments', docId: enrRef.id, campusId,
    after: { childId: child.id, code: child.code, classId: cls.id, startDate: p.startDate, exception: force },
  });
  return { childId: child.id, code: child.code, enrollmentId: enrRef.id, classId: cls.id, campusId, guardians: guardians.map((g) => ({ id: g.id, status: g.status, inviteCode: g.inviteCode ?? null, warning: g.warning })) };
}

// ------------------------------------------------------------------ nội bộ: chuyển lớp/cơ sở

async function executeTransfer(ctx: Ctx, tr: DocumentData & { id: string }) {
  const child = await childOf(ctx, tr.childId);
  if (!IN_SCHOOL.includes(child.status) || child.classId !== tr.fromClassId) {
    fail('INVALID_STATE', 'Trẻ không còn ở lớp ban đầu nên không thể thực hiện chuyển.');
  }
  const toClass = await requireOpenClass(ctx, tr.toClassId);
  const effective = tr.effectiveDate as string;
  const childRef = ctx.doc(`children/${child.id}`);
  const newEnr = ctx.col('enrollments').doc();
  const trRef = ctx.doc(`transfers/${tr.id}`);
  const cross = tr.fromCampusId !== tr.toCampusId;

  await ctx.tx(async (t) => {
    const cs = await t.get(ctx.doc(`classes/${toClass.id}`));
    const cap = (cs.data()!.capacity as number) ?? 0;
    const full = await t.get(ctx.col('enrollments').where('classId', '==', toClass.id).where('status', '==', 'active'));
    if (full.size >= cap) fail('LIMIT', `Lớp đến đã đủ sĩ số (${full.size}/${cap}). Chưa thể hoàn tất chuyển.`, { capacity: cap, enrolled: full.size });
    const oldQ = await t.get(ctx.col('enrollments').where('childId', '==', child.id).where('status', '==', 'active'));
    const cur = await t.get(childRef);
    const trs = await t.get(trRef);
    for (const o of oldQ.docs) {
      const start = (o.data().startDate as string) ?? effective;
      const end = addDays(effective, -1);
      t.update(o.ref, { status: 'ended', endDate: end < start ? start : end, endReason: 'transfer', transferId: tr.id, ...ctx.metaUpdate((o.data().version as number) ?? 1) });
    }
    t.create(newEnr, {
      childId: child.id, classId: toClass.id, campusId: toClass.campusId, startDate: effective, endDate: null, status: 'active',
      source: 'transfer', transferId: tr.id, ...ctx.metaCreate(),
    });
    t.update(childRef, { classId: toClass.id, campusId: toClass.campusId, ...ctx.metaUpdate((cur.data()!.version as number) ?? 1) });
    t.update(trRef, {
      status: 'completed', completedAt: Timestamp.fromDate(ctx.now), completedBy: ctx.uid, newEnrollmentId: newEnr.id,
      ...ctx.metaUpdate((trs.data()!.version as number) ?? 1),
    });
  });
  await syncEnrolledCount(ctx, tr.fromClassId);
  await syncEnrolledCount(ctx, toClass.id);

  const moved: Record<string, number> = { receivables: 0, deposits: 0, guardianLinks: 0, pickupAuthorizations: 0 };
  if (cross) {
    const toCampus = toClass.campusId;
    for (const col of ['guardianLinks', 'pickupAuthorizations']) {
      const q = await ctx.col(col).where('childId', '==', child.id).get();
      for (const grp of chunk(q.docs, 400)) {
        const b = db.batch();
        grp.forEach((d) => b.update(d.ref, { campusId: toCampus, updatedAt: Timestamp.fromDate(ctx.now), version: FieldValue.increment(1) }));
        await b.commit();
        moved[col] += grp.length;
      }
    }
    if (tr.debtHandling === 'move') {
      const q = await ctx.col('receivables').where('childId', '==', child.id).get();
      const open = q.docs.filter((d) => !['paid', 'cancelled'].includes(d.data().status));
      for (const grp of chunk(open, 400)) {
        const b = db.batch();
        grp.forEach((d) => b.update(d.ref, { campusId: toCampus, movedFromCampusId: tr.fromCampusId, movedByTransferId: tr.id, updatedAt: Timestamp.fromDate(ctx.now), version: FieldValue.increment(1) }));
        await b.commit();
        moved.receivables += grp.length;
      }
    }
    const dq = await ctx.col('deposits').where('childId', '==', child.id).get();
    const held = dq.docs.filter((d) => d.data().status === 'held');
    if (tr.depositHandling === 'move') {
      for (const d of held) {
        await d.ref.update({ campusId: toCampus, movedFromCampusId: tr.fromCampusId, updatedAt: Timestamp.fromDate(ctx.now), version: FieldValue.increment(1) });
        await createDoc(ctx, 'depositMovements', undefined, {
          transferId: tr.id, childId: child.id, depositId: d.id, amount: d.data().amount ?? 0, fromCampusId: tr.fromCampusId, toCampusId: toCampus,
          campusId: toCampus, type: 'transfer', note: 'Điều chuyển đặt cọc khi chuyển cơ sở',
        });
        moved.deposits++;
      }
    } else if (tr.depositHandling === 'refund' && held.length) {
      await trRef.update({ depositRefundPending: held.map((d) => d.id) });
    }
  }
  await ctx.audit({
    action: 'transfer.execute', collection: 'transfers', docId: tr.id, campusId: toClass.campusId,
    before: { classId: tr.fromClassId, campusId: tr.fromCampusId }, after: { classId: toClass.id, campusId: toClass.campusId, effectiveDate: effective, moved },
  });
  return { moved, newEnrollmentId: newEnr.id };
}

async function cancelOtherTransferApprovals(ctx: Ctx, tr: DocumentData, exceptApprovalId?: string, status: 'cancelled' = 'cancelled') {
  for (const side of Object.values(asObj(tr.sides))) {
    const aid = (side as any).approvalId as string | undefined;
    if (!aid || aid === exceptApprovalId) continue;
    const r = ctx.doc(`approvals/${aid}`);
    const sn = await r.get();
    if (sn.exists && sn.data()!.status === 'pending') await r.update({ status, cancelReason: 'Yêu cầu chuyển đã đóng', updatedAt: Timestamp.fromDate(ctx.now), version: FieldValue.increment(1) });
  }
}

registerApprovalHandler('transfer', {
  perm: 'children.transfer',
  async onApprove(ctx: Ctx, ap: ApprovalDoc) {
    const trRef = ctx.doc(`transfers/${ap.refId}`);
    const tr = (await getOr404(trRef, 'Yêu cầu chuyển')) as DocumentData & { id: string };
    if (tr.status !== 'pending') fail('INVALID_STATE', 'Yêu cầu chuyển không còn ở trạng thái chờ duyệt.', { status: tr.status });
    const sides = asObj(tr.sides);
    const key = ap.campusId as string;
    if (!sides[key]) fail('INVALID_STATE', 'Yêu cầu chuyển không có bước duyệt tại cơ sở này.');
    const others = Object.entries(sides).filter(([k]) => k !== key);
    const allOthersOk = others.every(([, v]) => (v as any).status === 'approved');
    sides[key] = { ...sides[key], status: 'approved', decidedBy: ctx.uid, decidedAt: Timestamp.fromDate(ctx.now) };
    if (allOthersOk) {
      await executeTransfer(ctx, { ...tr, sides });
      await trRef.update({ sides });
      return { transferId: tr.id, completed: true };
    }
    await trRef.update({ sides, ...ctx.metaUpdate((tr.version as number) ?? 1) });
    await ctx.audit({ action: 'transfer.approveSide', collection: 'transfers', docId: tr.id, campusId: key, after: { side: key } });
    return { transferId: tr.id, completed: false, waitingFor: others.filter(([, v]) => (v as any).status !== 'approved').map(([k]) => k) };
  },
  async onReject(ctx: Ctx, ap: ApprovalDoc, note?: string) {
    const trRef = ctx.doc(`transfers/${ap.refId}`);
    const tr = (await getOr404(trRef, 'Yêu cầu chuyển')) as DocumentData & { id: string };
    if (tr.status !== 'pending') return null;
    const sides = asObj(tr.sides);
    sides[ap.campusId as string] = { ...sides[ap.campusId as string], status: 'rejected', decidedBy: ctx.uid, decidedAt: Timestamp.fromDate(ctx.now), note: s(note) };
    await trRef.update({ status: 'rejected', sides, rejectedBy: ctx.uid, rejectNote: s(note), ...ctx.metaUpdate((tr.version as number) ?? 1) });
    await cancelOtherTransferApprovals(ctx, tr, ap.id);
    return { transferId: tr.id, status: 'rejected' };
  },
});

registerCancelHook('transfer', async (ctx, ap, reason) => {
  const trRef = ctx.doc(`transfers/${ap.refId}`);
  const tr = await trRef.get();
  if (!tr.exists || tr.data()!.status !== 'pending') return;
  await trRef.update({ status: 'cancelled', cancelReason: s(reason), ...ctx.metaUpdate((tr.data()!.version as number) ?? 1) });
  await cancelOtherTransferApprovals(ctx, tr.data()!, ap.id);
});

registerApprovalHandler('enrollment_exception', {
  perm: 'classes.write',
  async onApprove(ctx: Ctx, ap: ApprovalDoc) {
    const pl = asObj(ap.payload);
    const result = await performEnroll(ctx, {
      existingChildId: pl.existingChildId, childData: asObj(pl.childData), health: pl.health, classId: pl.classId, startDate: pl.startDate,
      feePlanId: pl.feePlanId, guardians: asArr(pl.guardians), leadId: pl.leadId, childStatus: pl.childStatus,
    }, true);
    return result;
  },
});

// ------------------------------------------------------------------ actions

const leadSchema: Schema = {
  childName: { t: 'string', req: true, min: 2, max: 120 },
  childDob: { t: 'day' },
  parentName: { t: 'string', req: true, min: 2, max: 120 },
  phone: { t: 'string', req: true, max: 30 },
  email: { t: 'string', max: 120 },
  source: { t: 'string', max: 60 },
  interestedClassId: { t: 'string', max: 128 },
  note: { t: 'string', max: 1000 },
  tourAt: { t: 'string', max: 40 },
  assignedTo: { t: 'string', max: 128 },
  documents: { t: 'array', max: 30, of: { t: 'string', max: 100 } },
};

export const actions: ActionMap = {
  // ---------------- tuyển sinh
  'lead.save': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = s(b.id);
      let existing: DocumentData | null = null;
      if (id) existing = await getOr404(ctx.doc(`leads/${id}`), 'Khách quan tâm');
      const campusId = existing ? (existing.campusId as string) : (await campusOf(ctx, s(b.campusId) || s(ctx.campusId))).id;
      ctx.require('leads.write', campusId);
      if (existing?.status === 'enrolled') fail('INVALID_STATE', 'Khách đã nhập học, không thể sửa nhu cầu.');
      const d = validate<Record<string, any>>(b, leadSchema, { partial: !!existing });
      if (d.phone !== undefined) d.phone = normPhone(d.phone);
      if (d.email) d.email = s(d.email).toLowerCase();
      if (d.tourAt) { const w = parseWhen(d.tourAt, 'tourAt'); d.tourAt = Timestamp.fromDate(w!); }
      const note = s(b.consultNote);
      if (!existing) {
        const dup = (await ctx.col('leads').where('phone', '==', d.phone).get()).docs
          .filter((x) => x.data().campusId === campusId && !['lost', 'enrolled'].includes(x.data().status))
          .map((x) => ({ id: x.id, childName: x.data().childName, status: x.data().status }));
        const data = {
          ...d, campusId, status: 'new', statusHistory: [{ status: 'new', at: Timestamp.fromDate(ctx.now), by: ctx.uid }],
          consultNotes: note ? [{ at: Timestamp.fromDate(ctx.now), by: ctx.uid, byName: ctx.member?.displayName ?? '', text: note }] : [],
          archived: false,
        };
        const nid = await createDoc(ctx, 'leads', undefined, data);
        await ctx.audit({ action: 'lead.save', collection: 'leads', docId: nid, campusId, after: { childName: d.childName, phone: d.phone } });
        return { id: nid, ...data, version: 1, duplicates: dup };
      }
      const patch: Record<string, any> = { ...d };
      if (note) patch.consultNotes = FieldValue.arrayUnion({ at: Timestamp.fromDate(ctx.now), by: ctx.uid, byName: ctx.member?.displayName ?? '', text: note });
      if (!Object.keys(patch).length) invalid({ childName: 'Không có thay đổi để lưu.' });
      const { before, after } = await updateDoc(ctx, ctx.doc(`leads/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'lead.save', collection: 'leads', docId: id, campusId, before: Object.fromEntries(Object.keys(d).map((k) => [k, before[k] ?? null])), after: d });
      return { id, ...after, duplicates: [] };
    },
  },

  'lead.setStatus': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const status = s(b.status);
      if (!(LEAD_STATUSES as readonly string[]).includes(status)) invalid({ status: 'Trạng thái không hợp lệ.' });
      const lead = await getOr404(ctx.doc(`leads/${id}`), 'Khách quan tâm');
      ctx.require('leads.write', lead.campusId);
      if (lead.status === status) return { id, status, unchanged: true };
      if (lead.status === 'enrolled') fail('INVALID_STATE', 'Khách đã nhập học, không đổi trạng thái được nữa.');
      if (status === 'enrolled' && !lead.enrolledChildId) fail('INVALID_STATE', 'Chỉ chuyển sang "đã nhập học" thông qua thao tác nhập học (lead.enroll).');
      if (status === 'lost' && !s(b.lostReason)) invalid({ lostReason: 'Vui lòng nhập lý do không tiếp tục.' });
      const patch: Record<string, any> = {
        status,
        statusHistory: FieldValue.arrayUnion({ status, at: Timestamp.fromDate(ctx.now), by: ctx.uid, note: s(b.note) || null }),
      };
      if (status === 'lost') patch.lostReason = s(b.lostReason);
      if (b.tourAt) patch.tourAt = Timestamp.fromDate(parseWhen(b.tourAt, 'tourAt')!);
      const { after } = await updateDoc(ctx, ctx.doc(`leads/${id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'lead.setStatus', collection: 'leads', docId: id, campusId: lead.campusId, before: { status: lead.status }, after: { status }, reason: s(b.note) || s(b.lostReason) || undefined });
      return { id, status, version: after.version };
    },
  },

  'lead.enroll': {
    scope: 'org',
    idempotent: true,
    handler: async (ctx, p) => {
      const b = asObj(p);
      const cls = await requireOpenClass(ctx, s(b.classId));
      ctx.require('children.write', cls.campusId);
      const startDate = requireDay(b.startDate, 'startDate');
      const campus = await campusOf(ctx, cls.campusId);
      if (startDate < addDays(todayOf(ctx, campus), -31)) invalid({ startDate: 'Ngày nhập học quá xa trong quá khứ.' });
      const childIn = asObj(b.child);
      const existingChildId = s(childIn.id) || undefined;
      let childData: Record<string, any> = {};
      if (!existingChildId) {
        childData = validate(childIn, childSchema);
        checkDob(ctx, childData.dob);
        const dups = await findDuplicates(ctx, childData.fullName, childData.dob);
        if (dups.length && b.confirmDuplicate !== true) fail('CONFLICT', 'Đã có hồ sơ trẻ trùng tên và ngày sinh. Kiểm tra lại hoặc xác nhận tạo mới.', { duplicates: dups });
        childData.archived = false;
      }
      let leadId: string | undefined;
      if (s(b.leadId)) {
        leadId = requireId(b.leadId, 'leadId');
        const lead = await getOr404(ctx.doc(`leads/${leadId}`), 'Khách quan tâm');
        ctx.require('leads.read', lead.campusId);
        if (lead.status === 'enrolled') fail('CONFLICT', 'Khách này đã được nhập học.');
        if (lead.status === 'lost') fail('INVALID_STATE', 'Khách đã dừng quan tâm. Hãy mở lại trạng thái trước khi nhập học.');
      }
      const guardians = asArr(b.guardians).map((g0) => {
        const g = asObj(g0);
        return { guardian: { name: g.name, phone: g.phone, email: g.email, relation: g.relation }, perms: g.perms ?? { notify: true } };
      });
      if (childIn.health || b.health) ctx.require('children.health.read', cls.campusId);
      const params: EnrollParams = {
        existingChildId, childData, health: childIn.health ?? b.health, classId: cls.id, startDate, feePlanId: s(b.feePlanId) || undefined,
        guardians, leadId, childStatus: s(childIn.status),
      };
      // cảnh báo độ tuổi
      const warnings: string[] = [];
      const dob = childData.dob;
      if (dob && (cls.minAgeMonths !== undefined || cls.maxAgeMonths !== undefined)) {
        const months = (Date.parse(startDate) - Date.parse(dob)) / (30.4375 * 86400_000);
        if ((cls.minAgeMonths !== undefined && months < cls.minAgeMonths) || (cls.maxAgeMonths !== undefined && months > cls.maxAgeMonths)) {
          warnings.push('Độ tuổi của trẻ nằm ngoài khối tuổi của lớp.');
        }
      }
      const enrolled = await activeEnrollmentCount(ctx, cls.id);
      const cap = (cls.capacity as number) ?? 0;
      if (enrolled >= cap) {
        if (b.requestException === true) {
          if (!s(b.exceptionReason)) invalid({ exceptionReason: 'Vui lòng nhập lý do xin nhận vượt sĩ số.' });
          const name = existingChildId ? (await childOf(ctx, existingChildId)).fullName : childData.fullName;
          const approvalId = await createApproval(ctx, {
            type: 'enrollment_exception', campusId: cls.campusId,
            summary: `Xin nhận trẻ ${name} vào lớp ${cls.name} vượt sĩ số (${enrolled}/${cap}).`,
            impact: { classId: cls.id, capacity: cap, enrolled, after: enrolled + 1, reason: s(b.exceptionReason) },
            refCollection: 'classes', refId: cls.id,
            payload: { ...params, exceptionReason: s(b.exceptionReason) },
          });
          await ctx.audit({ action: 'lead.enroll.requestException', collection: 'approvals', docId: approvalId, campusId: cls.campusId, reason: s(b.exceptionReason) });
          return { status: 'pending_approval', approvalId, capacity: cap, enrolled };
        }
        fail('LIMIT', `Lớp ${cls.name} đã đủ sĩ số (${enrolled}/${cap}).`, {
          capacity: cap, enrolled, classId: cls.id, suggestions: await freeSeatSuggestions(ctx, cls.campusId, cls.id),
        });
      }
      const result = await performEnroll(ctx, params, false);
      return { status: 'enrolled', ...result, warnings };
    },
  },

  // ---------------- hồ sơ trẻ
  'child.save': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b0 = asObj(p);
      const b = b0.child ? { ...b0, ...asObj(b0.child) } : b0;
      const id = s(b.id);
      const health = b.health;
      if (!id) {
        const campusId = (await campusOf(ctx, s(b.campusId) || s(ctx.campusId))).id;
        ctx.require('children.write', campusId);
        const d = validate<Record<string, any>>(b, childSchema);
        checkDob(ctx, d.dob);
        const dups = await findDuplicates(ctx, d.fullName, d.dob);
        if (dups.length && b.confirmDuplicate !== true) fail('CONFLICT', 'Đã có hồ sơ trẻ trùng tên và ngày sinh. Kiểm tra lại hoặc xác nhận tạo mới.', { duplicates: dups });
        if (health) ctx.require('children.health.read', campusId);
        const status = ['pending', 'trial'].includes(s(b.status)) ? s(b.status) : 'pending';
        const created = await createChildDoc(ctx, campusId, d, { classId: null, status, archived: false });
        if (health) await writeHealth(ctx, created.id, campusId, health);
        await ctx.audit({ action: 'child.save', collection: 'children', docId: created.id, campusId, after: { code: created.code, fullName: d.fullName } });
        return { id: created.id, code: created.code, campusId, status, version: 1 };
      }
      const cur = await childOf(ctx, id);
      ctx.require('children.write', cur.campusId);
      if (cur.status === 'archived') fail('INVALID_STATE', 'Hồ sơ đã lưu trữ, không thể sửa.');
      if (b.code !== undefined && s(b.code).toUpperCase() !== cur.code) invalid({ code: 'Không được đổi mã trẻ.' });
      if (b.campusId !== undefined && s(b.campusId) && s(b.campusId) !== cur.campusId) invalid({ campusId: 'Đổi cơ sở phải dùng chức năng chuyển cơ sở.' });
      const { code: _c, ...schemaNoCode } = childSchema;
      void _c;
      const d = validate<Record<string, any>>(b, schemaNoCode, { partial: true });
      if (d.dob) checkDob(ctx, d.dob);
      if ((d.fullName || d.dob) && b.confirmDuplicate !== true) {
        const dups = await findDuplicates(ctx, d.fullName ?? cur.fullName, d.dob ?? cur.dob, id);
        if (dups.length) fail('CONFLICT', 'Đã có hồ sơ trẻ trùng tên và ngày sinh.', { duplicates: dups });
      }
      if (health) ctx.require('children.health.read', cur.campusId);
      let after: DocumentData = cur;
      if (Object.keys(d).length) {
        const r = await updateDoc(ctx, ctx.doc(`children/${id}`), d, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
        after = r.after;
        await ctx.audit({ action: 'child.save', collection: 'children', docId: id, campusId: cur.campusId, before: Object.fromEntries(Object.keys(d).map((k) => [k, r.before[k] ?? null])), after: d });
      } else if (!health) invalid({ fullName: 'Không có thay đổi để lưu.' });
      if (health) await writeHealth(ctx, id, cur.campusId, health);
      return { id, code: cur.code, campusId: cur.campusId, status: after.status, version: after.version };
    },
  },

  'child.setStatus': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      ctx.require('children.write', child.campusId);
      const status = s(b.status);
      if (!(CHILD_STATUSES as readonly string[]).includes(status)) invalid({ status: 'Trạng thái không hợp lệ.' });
      const effectiveDate = requireDay(b.effectiveDate, 'effectiveDate');
      const reason = s(b.reason);
      if (!reason) invalid({ reason: 'Vui lòng nhập lý do.' });
      if (child.status === status) return { childId: child.id, status, unchanged: true };
      const leaving = status === 'withdrawn' || status === 'archived';
      if (['withdrawn', 'archived'].includes(child.status) && IN_SCHOOL.includes(status)) {
        fail('INVALID_STATE', 'Trẻ đã thôi học. Hãy nhập học lại bằng chức năng nhập học.');
      }
      if (IN_SCHOOL.includes(status) && !child.classId) fail('INVALID_STATE', 'Trẻ chưa được xếp lớp nên chưa thể đặt trạng thái này.');
      const prevClass = child.classId ?? null;
      const patch: Record<string, any> = { status, statusEffectiveDate: effectiveDate, statusReason: reason };
      if (leaving || status === 'pending') patch.classId = null;
      if (leaving) patch.lastClassId = prevClass;
      const { before, after } = await updateDoc(ctx, ctx.doc(`children/${child.id}`), patch, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      if (leaving || status === 'pending') {
        const q = await ctx.col('enrollments').where('childId', '==', child.id).where('status', '==', 'active').get();
        for (const e of q.docs) {
          const start = (e.data().startDate as string) ?? effectiveDate;
          await e.ref.update({ status: 'ended', endDate: effectiveDate < start ? start : effectiveDate, endReason: status, ...ctx.metaUpdate((e.data().version as number) ?? 1) });
        }
        await syncEnrolledCount(ctx, prevClass);
      }
      await createDoc(ctx, 'childStatusHistory', undefined, {
        childId: child.id, campusId: child.campusId, from: before.status, to: status, effectiveDate, reason,
        at: Timestamp.fromDate(ctx.now), by: ctx.uid, byName: ctx.member?.displayName ?? ctx.uid,
      });
      let outstanding = 0;
      if (leaving) {
        const r = await ctx.col('receivables').where('childId', '==', child.id).get();
        outstanding = r.docs.filter((d) => !['paid', 'cancelled', 'draft'].includes(d.data().status) && (typeof d.data().balance !== 'number' || d.data().balance > 0)).length;
      }
      await ctx.audit({ action: 'child.setStatus', collection: 'children', docId: child.id, campusId: child.campusId, before: { status: before.status, classId: prevClass }, after: { status, effectiveDate }, reason });
      return { childId: child.id, status, effectiveDate, version: after.version, outstandingReceivables: outstanding };
    },
  },

  'child.linkGuardian': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      ctx.require('children.write', child.campusId);
      if (child.status === 'archived') fail('INVALID_STATE', 'Hồ sơ đã lưu trữ.');
      const r = await linkGuardianCore(ctx, child, b.guardian, b.perms);
      return { id: r.id, status: r.status, uid: r.uid ?? null, inviteCode: r.inviteCode ?? null, perms: r.perms, warning: r.warning ?? null };
    },
  },

  'child.unlinkGuardian': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      ctx.require('children.write', child.campusId);
      const r = await unlinkGuardianCore(ctx, child, requireId(b.linkId ?? b.id, 'linkId'), s(b.reason));
      return { id: r.id, status: 'unlinked' };
    },
  },

  // ---------------- phân công giáo viên
  'assignment.save': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = s(b.id);
      let existing: DocumentData | null = null;
      if (id) existing = await getOr404(ctx.doc(`assignments/${id}`), 'Phân công');
      const cls = await classOf(ctx, existing ? existing.classId : b.classId);
      ctx.require('classes.write', cls.campusId);
      if (existing && b.cancel === true) {
        const { after } = await updateDoc(ctx, ctx.doc(`assignments/${id}`), { status: 'cancelled', cancelReason: s(b.reason) || null });
        await ctx.audit({ action: 'assignment.cancel', collection: 'assignments', docId: id, campusId: cls.campusId, before: { status: existing.status }, after: { status: 'cancelled' }, reason: s(b.reason) || undefined });
        return { id, status: 'cancelled', version: after.version };
      }
      const uid = requireId(existing ? existing.uid : b.uid, 'uid');
      const role = s(b.role ?? existing?.role);
      if (!['main', 'assistant', 'substitute'].includes(role)) invalid({ role: 'Vai trò phải là main, assistant hoặc substitute.' });
      const mem = await ctx.doc(`members/${uid}`).get();
      if (!mem.exists || mem.data()!.status !== 'active' || mem.data()!.kind === 'parent') invalid({ uid: 'Nhân sự không tồn tại hoặc chưa kích hoạt.' });
      if (!hasPerm(mem.data()!.permsByCampus, 'attendance.write', cls.campusId)) invalid({ uid: 'Nhân sự chưa được cấp vai trò giáo viên tại cơ sở này.' });
      const from = parseWhen(b.validFrom ?? existing?.validFrom, 'validFrom') ?? ctx.now;
      const to = parseWhen(b.validTo === null ? null : (b.validTo ?? tsOf(existing?.validTo)?.toISOString()), 'validTo', true);
      if (to && to <= from) invalid({ validTo: 'Thời điểm kết thúc phải sau thời điểm bắt đầu.' });
      const fromMs = from.getTime();
      const toMs = to ? to.getTime() : Infinity;
      const all = await ctx.col('assignments').where('campusId', '==', cls.campusId).get();
      const conflicts = all.docs.filter((d) => {
        const a = d.data();
        if (d.id === id || a.status === 'cancelled') return false;
        const aFrom = tsOf(a.validFrom)?.getTime() ?? 0;
        const aTo = tsOf(a.validTo)?.getTime() ?? Infinity;
        if (!(fromMs < aTo && aFrom < toMs)) return false;
        if (a.uid === uid) return true; // một người không thể hai phân công trùng thời gian
        return a.classId === cls.id && a.role === 'main' && role === 'main'; // một lớp chỉ một giáo viên chính tại một thời điểm
      }).map((d) => ({ id: d.id, classId: d.data().classId, uid: d.data().uid, role: d.data().role, validFrom: d.data().validFrom, validTo: d.data().validTo ?? null }));
      if (conflicts.length) fail('CONFLICT', 'Phân công bị chồng lấn với phân công khác.', { conflicts });
      const data = { classId: cls.id, campusId: cls.campusId, uid, role, validFrom: Timestamp.fromDate(from), validTo: to ? Timestamp.fromDate(to) : null, note: s(b.note), employeeId: mem.data()!.employeeId ?? null };
      if (!existing) {
        const nid = await createDoc(ctx, 'assignments', undefined, { ...data, status: 'active', teacherName: mem.data()!.displayName });
        await ctx.audit({ action: 'assignment.save', collection: 'assignments', docId: nid, campusId: cls.campusId, after: { classId: cls.id, uid, role } });
        return { id: nid, ...data, status: 'active', version: 1 };
      }
      const { before, after } = await updateDoc(ctx, ctx.doc(`assignments/${id}`), data, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
      await ctx.audit({ action: 'assignment.save', collection: 'assignments', docId: id, campusId: cls.campusId, before: { uid: before.uid, role: before.role }, after: { uid, role } });
      return { id, ...after };
    },
  },

  // ---------------- chuyển lớp / cơ sở
  'transfer.request': {
    scope: 'org',
    idempotent: true,
    handler: async (ctx, p) => {
      const b = asObj(p);
      const child = await childOf(ctx, b.childId);
      ctx.require('children.transfer', child.campusId);
      if (!IN_SCHOOL.includes(child.status) || !child.classId) fail('INVALID_STATE', 'Chỉ chuyển được trẻ đang học và đã có lớp.');
      if (!s(b.toClassId)) invalid({ toClassId: 'Vui lòng chọn lớp đến.' });
      const toClass = await requireOpenClass(ctx, s(b.toClassId));
      if (s(b.toCampusId) && s(b.toCampusId) !== toClass.campusId) invalid({ toCampusId: 'Lớp đến không thuộc cơ sở đã chọn.' });
      if (toClass.id === child.classId) invalid({ toClassId: 'Lớp đến trùng lớp hiện tại.' });
      const effectiveDate = requireDay(b.effectiveDate, 'effectiveDate');
      const campus = await campusOf(ctx, child.campusId);
      if (effectiveDate < todayOf(ctx, campus)) invalid({ effectiveDate: 'Ngày hiệu lực không được ở quá khứ.' });
      const cross = toClass.campusId !== child.campusId;
      const debtHandling = s(b.debtHandling) || 'stay';
      const depositHandling = s(b.depositHandling) || 'stay';
      if (!['stay', 'move'].includes(debtHandling)) invalid({ debtHandling: 'Chọn stay hoặc move.' });
      if (!['stay', 'move', 'refund'].includes(depositHandling)) invalid({ depositHandling: 'Chọn stay, move hoặc refund.' });
      const pend = await ctx.col('transfers').where('childId', '==', child.id).where('status', '==', 'pending').limit(1).get();
      if (!pend.empty) fail('CONFLICT', 'Trẻ đang có yêu cầu chuyển chờ duyệt.', { transferId: pend.docs[0].id });
      const enrolled = await activeEnrollmentCount(ctx, toClass.id);
      const cap = (toClass.capacity as number) ?? 0;
      if (enrolled >= cap) {
        fail('LIMIT', `Lớp đến đã đủ sĩ số (${enrolled}/${cap}).`, { capacity: cap, enrolled, suggestions: await freeSeatSuggestions(ctx, toClass.campusId, toClass.id) });
      }
      // tác động: công nợ & đặt cọc
      const rc = await ctx.col('receivables').where('childId', '==', child.id).get();
      const openDebt = rc.docs.filter((d) => !['paid', 'cancelled', 'draft'].includes(d.data().status));
      const debtAmount = openDebt.reduce((sum, d) => sum + (typeof d.data().balance === 'number' ? d.data().balance : 0), 0);
      const dp = await ctx.col('deposits').where('childId', '==', child.id).get();
      const held = dp.docs.filter((d) => d.data().status === 'held');
      const impact = {
        fromClassId: child.classId, toClassId: toClass.id, crossCampus: cross, effectiveDate, debtHandling, depositHandling,
        openReceivables: openDebt.length, openDebtAmount: debtAmount, depositsHeld: held.length, depositAmount: held.reduce((x, d) => x + (d.data().amount ?? 0), 0),
      };
      const trId = await createDoc(ctx, 'transfers', undefined, {
        childId: child.id, childName: child.fullName, childCode: child.code, fromCampusId: child.campusId, fromClassId: child.classId,
        toCampusId: toClass.campusId, toClassId: toClass.id, effectiveDate, debtHandling, depositHandling, reason: s(b.reason),
        crossCampus: cross, campusId: child.campusId, status: 'pending', sides: {}, impact,
      });
      const campuses = [...new Set([child.campusId, toClass.campusId])];
      const sides: Record<string, any> = {};
      for (const c of campuses) {
        const approvalId = await createApproval(ctx, {
          type: 'transfer', campusId: c,
          summary: `Chuyển ${child.fullName} (${child.code}) ${cross ? 'sang cơ sở khác' : 'sang lớp khác'} từ ${effectiveDate}.`,
          impact, refCollection: 'transfers', refId: trId, payload: { transferId: trId },
        });
        sides[c] = { status: 'pending', approvalId };
      }
      await ctx.doc(`transfers/${trId}`).update({ sides });
      await ctx.audit({ action: 'transfer.request', collection: 'transfers', docId: trId, campusId: child.campusId, after: impact, reason: s(b.reason) || undefined });
      return { id: trId, status: 'pending', sides, impact };
    },
  },

  'transfer.decide': {
    scope: 'org',
    handler: async (ctx, p) => {
      const b = asObj(p);
      const id = requireId(b.id, 'id');
      const tr = await getOr404(ctx.doc(`transfers/${id}`), 'Yêu cầu chuyển');
      const sides = asObj(tr.sides);
      const pending = Object.entries(sides).filter(([, v]) => (v as any).status === 'pending');
      let key = s(b.campusId);
      if (!key) {
        const mine = pending.filter(([c]) => ctx.can('children.transfer', c));
        if (!mine.length) denied('Bạn không có quyền duyệt yêu cầu chuyển này.');
        key = mine[0][0];
      }
      const side = sides[key] as { status: string; approvalId: string } | undefined;
      if (!side) invalid({ campusId: 'Cơ sở không thuộc yêu cầu chuyển này.' });
      const r = await decideApprovalCore(ctx, side!.approvalId, s(b.decision), s(b.note));
      const fresh = await ctx.doc(`transfers/${id}`).get();
      return { id, transferStatus: fresh.data()!.status, approval: { id: side!.approvalId, status: (r as any).status }, result: (r as any).result ?? null };
    },
  },
};
