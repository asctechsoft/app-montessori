// Nhập dữ liệu (W46) và sao lưu. KHÔNG có action phục hồi: phục hồi là thao tác hạ tầng có kiểm soát (xem backend/README).
import type { ActionMap, Ctx } from '../core/types';
import { Timestamp } from '../core/firebase';
import { denied, fail, invalid } from '../core/errors';
import { createDoc, dayKeyOf, getCampus } from '../core/store';
import { isValidDay } from '../core/validate';
import { asDocs, Doc, getInCampus, needStr, resolveCampus, toDate } from '../lib/common';
import { actions as childrenActions } from './children';
import { actions as hrActions } from './hr';

const KINDS = ['children', 'staff', 'guardians'] as const;
type Kind = (typeof KINDS)[number];
const MAX_ROWS = 500;

interface RowResult { index: number; line: number; raw: Record<string, any>; data: Record<string, any>; errors: Array<{ field: string; message: string }>; warnings: string[] }

export function normPhoneVN(v: unknown): string {
  let d = String(v ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+84')) d = '0' + d.slice(3);
  else if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2);
  return d;
}
export const isValidPhoneVN = (p: string): boolean => /^0\d{9,10}$/.test(p);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[A-Za-z0-9_-]{2,20}$/;
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

const needImportPerm = (ctx: Ctx, kind: Kind, campusId: string) => {
  ctx.require('import.write', campusId);
  ctx.require(kind === 'staff' ? 'staff.write' : 'children.write', campusId);
};

async function validateChildren(ctx: Ctx, campusId: string, rows: Array<Record<string, any>>): Promise<RowResult[]> {
  const classes = asDocs(await ctx.col('classes').where('campusId', '==', campusId).get()).filter((c) => !c.archived);
  const existingCodes = new Set((await ctx.col('children').where('campusId', '==', campusId).get()).docs.map((d) => String(d.data().code ?? '').toUpperCase()));
  const existing = asDocs(await ctx.col('children').where('campusId', '==', campusId).get());
  const seen = new Map<string, number>();
  const nameDob = new Map<string, number>();
  const today = dayKeyOf(ctx.now);
  return rows.map((raw, index) => {
    const errors: RowResult['errors'] = []; const warnings: string[] = [];
    const code = str(raw.code).toUpperCase(); const fullName = str(raw.fullName); const dob = str(raw.dob);
    const data: Record<string, any> = { fullName, dob };
    if (!fullName || fullName.length < 2) errors.push({ field: 'fullName', message: 'Thiếu họ tên (tối thiểu 2 ký tự).' });
    if (!isValidDay(dob)) errors.push({ field: 'dob', message: 'Ngày sinh không hợp lệ (YYYY-MM-DD).' });
    else if (dob > today) errors.push({ field: 'dob', message: 'Ngày sinh ở tương lai.' });
    if (code) {
      data.code = code;
      if (!CODE_RE.test(code)) errors.push({ field: 'code', message: 'Mã trẻ chỉ gồm chữ, số, gạch (2–20 ký tự).' });
      else if (isValidPhoneVN(normPhoneVN(code)) && /^\d{9,}$/.test(code.replace(/\D/g, '')) && code.replace(/\D/g, '').length >= 9) errors.push({ field: 'code', message: 'Mã trẻ trông giống số điện thoại; mã trẻ không được dùng số điện thoại.' });
      if (existingCodes.has(code)) errors.push({ field: 'code', message: `Mã trẻ ${code} đã tồn tại.` });
      if (seen.has(code)) errors.push({ field: 'code', message: `Mã trẻ ${code} bị lặp ở dòng ${seen.get(code)! + 2}.` }); else seen.set(code, index);
    }
    if (str(raw.gender)) { const g = str(raw.gender).toLowerCase(); if (!['male', 'female', 'other'].includes(g)) errors.push({ field: 'gender', message: 'Giới tính: male | female | other.' }); else data.gender = g; }
    const clsKey = str(raw.classCode ?? raw.className ?? raw.classId);
    if (clsKey) {
      const cls = classes.find((c) => c.id === clsKey || String(c.code ?? '').toLowerCase() === clsKey.toLowerCase() || String(c.name ?? '').toLowerCase() === clsKey.toLowerCase());
      if (!cls) errors.push({ field: 'classCode', message: `Không tìm thấy lớp "${clsKey}" ở cơ sở này.` }); else data.classId = cls.id;
    }
    if (str(raw.startDate)) { if (!isValidDay(str(raw.startDate))) errors.push({ field: 'startDate', message: 'Ngày nhập học không hợp lệ.' }); else data.startDate = str(raw.startDate); }
    if (data.classId && !data.startDate) data.startDate = today;
    if (str(raw.guardianPhone)) {
      const ph = normPhoneVN(raw.guardianPhone);
      if (!isValidPhoneVN(ph)) errors.push({ field: 'guardianPhone', message: 'Số điện thoại phụ huynh không hợp lệ.' });
      else if (existingCodes.has(ph) || seen.has(ph.toUpperCase())) errors.push({ field: 'guardianPhone', message: 'Số điện thoại phụ huynh trùng với một mã trẻ.' });
      else { data.guardianPhone = ph; data.guardianName = str(raw.guardianName); data.guardianRelation = str(raw.guardianRelation) || 'other'; if (!data.guardianName) errors.push({ field: 'guardianName', message: 'Có SĐT phụ huynh thì cần họ tên phụ huynh.' }); }
    }
    // Không tự ghép chỉ vì trùng tên: chỉ cảnh báo, người nhập tự quyết (allowPossibleDuplicates).
    if (fullName && isValidDay(dob)) {
      const key = `${fullName.toLowerCase()}|${dob}`;
      const dup = existing.find((c) => String(c.fullName ?? '').toLowerCase() === fullName.toLowerCase() && c.dob === dob);
      if (dup) warnings.push(`Có thể trùng hồ sơ ${dup.code ?? dup.id} (cùng họ tên và ngày sinh). Hệ thống KHÔNG tự ghép.`);
      if (nameDob.has(key)) warnings.push(`Trùng họ tên + ngày sinh với dòng ${nameDob.get(key)! + 2} trong file.`); else nameDob.set(key, index);
      data.possibleDuplicate = !!dup || warnings.length > 0;
    }
    return { index, line: index + 2, raw, data, errors, warnings };
  });
}

async function validateStaff(ctx: Ctx, campusId: string, rows: Array<Record<string, any>>): Promise<RowResult[]> {
  const campuses = asDocs(await ctx.col('campuses').get());
  const existing = asDocs(await ctx.col('employees').get());
  const codes = new Set(existing.map((e) => String(e.code ?? '').toUpperCase()));
  const seen = new Map<string, number>();
  return rows.map((raw, index) => {
    const errors: RowResult['errors'] = []; const warnings: string[] = [];
    const code = str(raw.code).toUpperCase(); const fullName = str(raw.fullName);
    const data: Record<string, any> = { code, fullName };
    if (!code) errors.push({ field: 'code', message: 'Thiếu mã nhân viên.' });
    else if (!CODE_RE.test(code)) errors.push({ field: 'code', message: 'Mã nhân viên chỉ gồm chữ, số, gạch (2–20 ký tự).' });
    else { if (codes.has(code)) errors.push({ field: 'code', message: `Mã nhân viên ${code} đã tồn tại.` }); if (seen.has(code)) errors.push({ field: 'code', message: `Mã ${code} bị lặp ở dòng ${seen.get(code)! + 2}.` }); else seen.set(code, index); }
    if (fullName.length < 2) errors.push({ field: 'fullName', message: 'Thiếu họ tên.' });
    if (str(raw.phone)) { const ph = normPhoneVN(raw.phone); if (!isValidPhoneVN(ph)) errors.push({ field: 'phone', message: 'Số điện thoại không hợp lệ.' }); else data.phone = ph; }
    if (str(raw.email)) { if (!EMAIL_RE.test(str(raw.email))) errors.push({ field: 'email', message: 'Email không hợp lệ.' }); else data.email = str(raw.email).toLowerCase(); }
    if (str(raw.title)) data.title = str(raw.title);
    if (str(raw.startDate)) { if (!isValidDay(str(raw.startDate))) errors.push({ field: 'startDate', message: 'Ngày vào làm không hợp lệ.' }); else data.startDate = str(raw.startDate); }
    const ck = str(raw.campusCode ?? raw.campusId);
    if (ck) {
      const c = campuses.find((x) => x.id === ck || String(x.code ?? '').toLowerCase() === ck.toLowerCase());
      if (!c) errors.push({ field: 'campusCode', message: `Không tìm thấy cơ sở "${ck}".` });
      else if (!ctx.can('staff.write', c.id) || !ctx.can('import.write', c.id)) errors.push({ field: 'campusCode', message: 'Bạn không có quyền nhập dữ liệu cho cơ sở này.' });
      else data.campusId = c.id;
    } else data.campusId = campusId;
    return { index, line: index + 2, raw, data, errors, warnings };
  });
}

async function validateGuardians(ctx: Ctx, campusId: string, rows: Array<Record<string, any>>): Promise<RowResult[]> {
  const kids = asDocs(await ctx.col('children').where('campusId', '==', campusId).get());
  const byCode = new Map(kids.map((c) => [String(c.code ?? '').toUpperCase(), c]));
  const seen = new Set<string>();
  return rows.map((raw, index) => {
    const errors: RowResult['errors'] = []; const warnings: string[] = [];
    const code = str(raw.childCode).toUpperCase(); const name = str(raw.name); const phone = normPhoneVN(raw.phone);
    const data: Record<string, any> = {};
    const child = byCode.get(code);
    if (!code) errors.push({ field: 'childCode', message: 'Thiếu mã trẻ.' });
    else if (!child) errors.push({ field: 'childCode', message: `Không tìm thấy trẻ có mã ${code} ở cơ sở này.` }); // không ghép theo tên
    else data.childId = child.id;
    if (name.length < 2) errors.push({ field: 'name', message: 'Thiếu họ tên phụ huynh.' }); else data.name = name;
    if (!isValidPhoneVN(phone)) errors.push({ field: 'phone', message: 'Số điện thoại không hợp lệ.' });
    else if (byCode.has(phone.toUpperCase())) errors.push({ field: 'phone', message: 'Số điện thoại trùng với một mã trẻ; mã trẻ ≠ số điện thoại.' });
    else data.phone = phone;
    if (str(raw.email)) { if (!EMAIL_RE.test(str(raw.email))) errors.push({ field: 'email', message: 'Email không hợp lệ.' }); else data.email = str(raw.email).toLowerCase(); }
    data.relation = str(raw.relation) || 'other';
    const flag = (v: unknown, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'x', 'yes', 'có'].includes(String(v).toLowerCase()));
    data.perms = { notify: flag(raw.notify, true), viewFees: flag(raw.viewFees, true), pickup: flag(raw.pickup, false) };
    const key = `${code}|${phone}`;
    if (seen.has(key)) errors.push({ field: 'phone', message: 'Phụ huynh này đã được liệt kê cho trẻ ở dòng trên.' }); else seen.add(key);
    // Một số điện thoại có thể gắn nhiều trẻ (anh chị em) — không phải lỗi.
    return { index, line: index + 2, raw, data, errors, warnings };
  });
}

const csvEsc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const importValidate = async (ctx: Ctx, p: any) => {
  const kind = p?.kind as Kind;
  if (!KINDS.includes(kind)) invalid({ kind: 'Loại nhập: children | staff | guardians.' });
  const { id: campusId } = await resolveCampus(ctx, p);
  needImportPerm(ctx, kind, campusId);
  const rows: any[] = Array.isArray(p?.rows) ? p.rows : [];
  if (!rows.length) invalid({ rows: 'File không có dòng dữ liệu.' });
  if (rows.length > MAX_ROWS) fail('LIMIT', `Mỗi lần nhập tối đa ${MAX_ROWS} dòng.`);
  const clean = rows.map((r) => (r && typeof r === 'object' ? r : {}));
  const res = kind === 'children' ? await validateChildren(ctx, campusId, clean) : kind === 'staff' ? await validateStaff(ctx, campusId, clean) : await validateGuardians(ctx, campusId, clean);
  const bad = res.filter((r) => r.errors.length);
  const jobId = await createDoc(ctx, 'importJobs', undefined, {
    kind, campusId, status: 'validated', fileName: typeof p?.fileName === 'string' ? p.fileName.slice(0, 200) : null, total: res.length, valid: res.length - bad.length, invalid: bad.length,
    rows: res.map((r) => ({ index: r.index, line: r.line, data: r.data, errors: r.errors, warnings: r.warnings })),
  });
  const errorCsv = ['Dòng,Trường,Lỗi', ...bad.flatMap((r) => r.errors.map((e) => [r.line, e.field, e.message].map(csvEsc).join(',')))].join('\r\n');
  await ctx.audit({ action: 'import.validate', collection: 'importJobs', docId: jobId, campusId, after: { kind, total: res.length, invalid: bad.length } });
  return {
    jobId, kind, total: res.length, valid: res.length - bad.length, invalid: bad.length,
    rows: res.map((r) => ({ line: r.line, ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings })),
    errorCsv: bad.length ? '﻿' + errorCsv : null,
  };
};

const importCommit = async (ctx: Ctx, p: any) => {
  const job = await getInCampus(ctx, 'importJobs', p?.jobId, null, 'Lượt nhập');
  ctx.require('import.write', job.campusId);
  needImportPerm(ctx, job.kind, job.campusId);
  if (job.status === 'committed') return { ...job.result, jobId: job.id, alreadyCommitted: true };
  if (job.status !== 'validated') fail('INVALID_STATE', `Lượt nhập đang ở trạng thái "${job.status}".`);
  if (job.invalid > 0 && p?.skipInvalid !== true) fail('PRECONDITION', `Còn ${job.invalid} dòng lỗi. Sửa file rồi kiểm tra lại, hoặc chọn bỏ qua dòng lỗi (skipInvalid).`, { reason: 'INVALID_ROWS', invalid: job.invalid });
  // khóa chống chạy đồng thời
  await ctx.tx(async (t) => {
    const s = await t.get(ctx.doc(`importJobs/${job.id}`));
    if (s.data()?.status !== 'validated') fail('INVALID_STATE', 'Lượt nhập đã/đang được xử lý.');
    t.update(ctx.doc(`importJobs/${job.id}`), { status: 'committing', committingBy: ctx.uid, updatedAt: Timestamp.now() });
  });
  const results: Array<{ line: number; result: 'created' | 'skipped' | 'error'; id?: string; message?: string }> = [];
  for (const r of job.rows as any[]) {
    if (r.errors.length) { results.push({ line: r.line, result: 'skipped', message: 'Dòng lỗi, bỏ qua.' }); continue; }
    try {
      if (job.kind === 'children') {
        const d = r.data;
        const guardians = d.guardianPhone ? [{ name: d.guardianName, phone: d.guardianPhone, relation: d.guardianRelation, perms: { notify: true, viewFees: true, pickup: false } }] : [];
        const child = { fullName: d.fullName, dob: d.dob, ...(d.code ? { code: d.code } : {}), ...(d.gender ? { gender: d.gender } : {}) };
        const confirm = p?.allowPossibleDuplicates === true;
        let out: any;
        if (d.classId) out = await childrenActions['lead.enroll'].handler(ctx, { classId: d.classId, startDate: d.startDate, child, guardians, confirmDuplicate: confirm });
        else {
          ctx.require('children.write', job.campusId);
          out = await childrenActions['child.save'].handler(ctx, { ...child, campusId: job.campusId, confirmDuplicate: confirm });
          for (const g of guardians) await childrenActions['child.linkGuardian'].handler(ctx, { childId: out.id, guardian: { name: g.name, phone: g.phone, relation: g.relation }, perms: g.perms });
        }
        results.push({ line: r.line, result: 'created', id: out.childId ?? out.id });
      } else if (job.kind === 'staff') {
        const out: any = await hrActions['employee.save'].handler(ctx, { ...r.data });
        results.push({ line: r.line, result: 'created', id: out.id });
      } else {
        const out: any = await childrenActions['child.linkGuardian'].handler(ctx, { childId: r.data.childId, guardian: { name: r.data.name, phone: r.data.phone, email: r.data.email, relation: r.data.relation }, perms: r.data.perms });
        results.push({ line: r.line, result: 'created', id: out.id ?? out.guardianId });
      }
    } catch (e: any) {
      results.push({ line: r.line, result: 'error', message: e?.message ?? 'Lỗi không xác định' }); // báo theo dòng, không dừng cả lô
    }
  }
  const count = (k: string) => results.filter((x) => x.result === k).length;
  const result = { created: count('created'), skipped: count('skipped'), errors: count('error'), results };
  await ctx.doc(`importJobs/${job.id}`).update({ status: 'committed', result, committedAt: Timestamp.now(), committedBy: ctx.uid, updatedAt: Timestamp.now() });
  await ctx.audit({ action: 'import.commit', collection: 'importJobs', docId: job.id, campusId: job.campusId, after: { kind: job.kind, created: result.created, errors: result.errors } });
  return { jobId: job.id, kind: job.kind, ...result };
};

// ---------------------------------------------------------------- sao lưu
function needOrgBackup(ctx: Ctx): void {
  if (!ctx.campusesFor('backup.manage').includes('*')) denied('Quản lý sao lưu cần quyền ở cấp toàn tổ chức.');
}

const backupRecord = async (ctx: Ctx, p: any) => {
  needOrgBackup(ctx);
  const status = p?.status === 'failed' ? 'failed' : 'success';
  const kind = p?.kind === 'manual' ? 'manual' : 'scheduled';
  const startedAt = toDate(p?.startedAt) ?? ctx.now;
  const finishedAt = toDate(p?.finishedAt);
  if (finishedAt && finishedAt < startedAt) invalid({ finishedAt: 'Thời điểm kết thúc phải sau thời điểm bắt đầu.' });
  if (p?.sizeBytes !== undefined && (!Number.isSafeInteger(p.sizeBytes) || p.sizeBytes < 0)) invalid({ sizeBytes: 'Dung lượng phải là số nguyên không âm.' });
  const id = await createDoc(ctx, 'backups', undefined, {
    kind, status, location: typeof p?.location === 'string' ? p.location.slice(0, 300) : null, exportName: typeof p?.exportName === 'string' ? p.exportName.slice(0, 200) : null,
    sizeBytes: p?.sizeBytes ?? null, startedAt: Timestamp.fromDate(startedAt), finishedAt: finishedAt ? Timestamp.fromDate(finishedAt) : null,
    note: typeof p?.note === 'string' ? p.note.slice(0, 500) : null, lastVerifiedAt: null, lastVerifyResult: null,
  });
  await ctx.audit({ action: 'backup.record', collection: 'backups', docId: id, after: { kind, status } });
  return { id, status };
};

const backupVerify = async (ctx: Ctx, p: any) => {
  needOrgBackup(ctx);
  const b = await getInCampus(ctx, 'backups', p?.backupId, null, 'Bản sao lưu');
  const result = p?.result === 'failed' ? 'failed' : 'success';
  if (b.status !== 'success') fail('PRECONDITION', 'Chỉ kiểm tra khôi phục với bản sao lưu thành công.');
  const notes = needStr(p?.notes ?? (result === 'success' ? 'Đã kiểm tra khôi phục trên môi trường thử.' : ''), 'notes', 1000);
  const vid = (await ctx.col(`backups/${b.id}/verifications`).add({
    result, notes, environment: typeof p?.environment === 'string' ? p.environment.slice(0, 100) : 'staging', testedAt: Timestamp.fromDate(toDate(p?.testedAt) ?? ctx.now),
    checks: p?.checks && typeof p.checks === 'object' ? p.checks : null, verifiedBy: ctx.uid, createdAt: Timestamp.now(),
  })).id;
  await ctx.doc(`backups/${b.id}`).update({ lastVerifiedAt: Timestamp.now(), lastVerifyResult: result, updatedAt: Timestamp.now(), updatedBy: ctx.uid, version: (b.version ?? 0) + 1 });
  await ctx.audit({ action: 'backup.verify', collection: 'backups', docId: b.id, after: { result }, reason: notes });
  return { backupId: b.id, verificationId: vid, result };
};

export const actions: ActionMap = {
  'import.validate': { scope: 'org', perm: 'import.write', handler: importValidate },
  'import.commit': { scope: 'org', perm: 'import.write', handler: importCommit },
  'backup.record': { scope: 'org', perm: 'backup.manage', handler: backupRecord },
  'backup.verify': { scope: 'org', perm: 'backup.manage', handler: backupVerify },
};

void getCampus; void ({} as Doc);
