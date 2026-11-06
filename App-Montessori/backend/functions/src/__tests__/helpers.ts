import './env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auth, db } from '../core/firebase';
import { createRouter } from '../core/router';
import { actions } from '../modules';

const handle = createRouter(actions);

export interface Caller { uid: string; token: Record<string, unknown> }

export async function makeUser(label: string, opts: { phone?: string; emailVerified?: boolean } = {}): Promise<Caller & { email: string }> {
  const email = `${label}.${randomUUID().slice(0, 8)}@test.local`;
  const u = await auth.createUser({ email, emailVerified: opts.emailVerified ?? true, displayName: label, password: 'Montessori@123', ...(opts.phone ? { phoneNumber: opts.phone } : {}) });
  return { uid: u.uid, email, token: { email, email_verified: true, name: label, ...(opts.phone ? { phone_number: opts.phone } : {}) } };
}

export async function call<T = any>(who: Caller, action: string, body: { orgId?: string; campusId?: string; payload?: unknown; opId?: string } = {}): Promise<T> {
  const res = await handle({ auth: { uid: who.uid, token: who.token }, data: { action, ...body } } as any);
  return res.data as T;
}

/** Gọi và mong đợi lỗi; trả details của HttpsError. */
export async function callFail(who: Caller, action: string, body: { orgId?: string; campusId?: string; payload?: unknown; opId?: string } = {}): Promise<{ code: string; message: string; details: any }> {
  try {
    await call(who, action, body);
  } catch (e: any) {
    assert.ok(e && e.httpErrorCode, `Lỗi không chuẩn hóa: ${String(e?.stack ?? e)}`);
    return { code: e.details?.code ?? e.code, message: e.message, details: e.details };
  }
  assert.fail(`Action ${action} lẽ ra phải bị từ chối`);
}

export const op = () => randomUUID();

export interface World {
  orgId: string;
  owner: Caller;
  principalCG: Caller; principalTX: Caller;
  lan: Caller; mai: Caller; hoa: Caller;       // lan, mai: giáo viên CG (Mầm 1) | hoa: giáo viên TX
  linh: Caller; thuy: Caller;                    // linh: mẹ bé An (CG) | thuy: mẹ bé Bình (TX)
  CG: string; TX: string;
  mam1: string; choi2: string; tx1: string;
  childAn: string; childAn2: string; childBinh: string;
}

async function inviteAndClaim(owner: Caller, orgId: string, user: Caller & { email: string }, name: string, grants: any[]) {
  await call(owner, 'member.invite', { orgId, payload: { kind: 'staff', email: user.email, displayName: name, grants } });
  const r = await call(user, 'invite.claimPending');
  assert.equal(r.joined.length, 1, `claim ${name}`);
}

export async function buildWorld(): Promise<World> {
  const owner = await makeUser('owner');
  const created = await call(owner, 'org.create', { payload: { name: `Mầm non Test ${randomUUID().slice(0, 6)}`, ownerCampus: { code: 'CG', name: 'Cầu Giấy', address: 'Hà Nội' } } });
  const orgId = created.orgId as string;
  const tx = await call(owner, 'campus.create', { orgId, payload: { code: 'TX', name: 'Thanh Xuân', address: 'Hà Nội', phone: '0900000000' } });
  const CG = 'CG'; const TX = tx.campus.id as string;
  const mk = async (campusId: string, code: string, name: string, capacity: number) =>
    (await call(owner, 'entity.save', { orgId, payload: { collection: 'classes', data: { campusId, code, name, capacity } } })).id as string;
  const mam1 = await mk(CG, 'M1', 'Mầm 1', 2);
  const choi2 = await mk(CG, 'C2', 'Chồi 2', 20);
  const tx1 = await mk(TX, 'TX1', 'Lá 1 TX', 20);

  const [principalCG, principalTX, lan, mai, hoa] = await Promise.all(['huong', 'tam', 'lan', 'mai', 'hoa'].map((n) => makeUser(n)));
  await inviteAndClaim(owner, orgId, principalCG, 'Cô Hương', [{ roleId: 'principal', campusIds: [CG] }]);
  await inviteAndClaim(owner, orgId, principalTX, 'Cô Tâm', [{ roleId: 'principal', campusIds: [TX] }]);
  await inviteAndClaim(owner, orgId, lan, 'Cô Lan', [{ roleId: 'teacher', campusIds: [CG], classIds: [mam1] }]);
  await inviteAndClaim(owner, orgId, mai, 'Cô Mai', [{ roleId: 'teacher', campusIds: [CG], classIds: [mam1] }]);
  await inviteAndClaim(owner, orgId, hoa, 'Cô Hoa', [{ roleId: 'teacher', campusIds: [TX], classIds: [tx1] }]);

  const linh = await makeUser('linh', { phone: '+84912000111' });
  const thuy = await makeUser('thuy', { phone: '+84912000222' });
  const guardian = (name: string, phone: string) => [{ name, phone, relation: 'mother', perms: { notify: true, viewFees: true, pickup: true } }];
  const an = await call(owner, 'lead.enroll', { orgId, opId: op(), payload: { classId: mam1, startDate: today(), child: { fullName: 'Nguyễn Minh An', dob: '2023-05-12', photoConsent: true }, guardians: guardian('Nguyễn Thùy Linh', '0912000111') } });
  const an2 = await call(owner, 'lead.enroll', { orgId, opId: op(), payload: { classId: mam1, startDate: today(), child: { fullName: 'Nguyễn Gia Bình', dob: '2023-07-01' }, guardians: [] } });
  const binh = await call(owner, 'lead.enroll', { orgId, opId: op(), payload: { classId: tx1, startDate: today(), child: { fullName: 'Trần Bảo Châu', dob: '2023-03-03' }, guardians: guardian('Trần Thu Thủy', '0912000222') } });
  assert.equal(an.status, 'enrolled');
  assert.equal((await call(linh, 'invite.claimPending')).joined.length, 1);
  assert.equal((await call(thuy, 'invite.claimPending')).joined.length, 1);
  return { orgId, owner, principalCG, principalTX, lan, mai, hoa, linh, thuy, CG, TX, mam1, choi2, tx1, childAn: an.childId, childAn2: an2.childId, childBinh: binh.childId };
}

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
export const addDay = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export { db, auth };
