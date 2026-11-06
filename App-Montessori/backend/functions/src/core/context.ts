import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from './firebase';
import { denied, fail } from './errors';
import { computePermsByCampus, hasPerm, campusesWithPerm, Grant } from './permissions';
import type { AuditEntry, Ctx, Member } from './types';

export interface BuildArgs {
  uid: string;
  token: Record<string, unknown>;
  orgId: string;
  campusId?: string;
  opId?: string;
  loadMember: boolean;
}

/** Tính lại permsByCampus từ grants (không tin cache) — chặn grant hết hạn ngay lập tức. */
export async function loadMember(orgId: string, uid: string, now: Date): Promise<Member | undefined> {
  const snap = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!snap.exists) return undefined;
  const m = snap.data() as Member;
  const rolesSnap = await db.collection(`orgs/${orgId}/roles`).get();
  const custom: Record<string, string[]> = {};
  rolesSnap.forEach((r) => { custom[r.id] = (r.data().perms as string[]) ?? []; });
  const campusIds = (await db.collection(`orgs/${orgId}/campuses`).select().get()).docs.map((d) => d.id);
  m.permsByCampus = computePermsByCampus((m.grants ?? []) as Grant[], custom, now, campusIds);
  if (m.kind === 'owner') {
    m.permsByCampus = computePermsByCampus([{ id: 'owner', roleId: 'owner', campusIds: ['*'] }], custom, now, campusIds);
  }
  m.childIds ??= [];
  return m;
}

export function buildCtx(a: BuildArgs, member: Member | undefined, platformAdmin: boolean): Ctx {
  const now = new Date();
  const ts = () => Timestamp.fromDate(now);
  const requestId = randomUUID();
  const orgPath = (p: string) => `orgs/${a.orgId}/${p}`;
  const active = member?.status === 'active';

  const ctx: Ctx = {
    uid: a.uid,
    email: a.token.email as string | undefined,
    phone: a.token.phone_number as string | undefined,
    token: a.token,
    platformAdmin,
    orgId: a.orgId,
    campusId: a.campusId,
    member,
    opId: a.opId,
    requestId,
    now,
    db,
    col: (p) => db.collection(orgPath(p)),
    doc: (p) => db.doc(orgPath(p)),
    can(perm, campusId) {
      if (platformAdmin) return true;
      if (!member || !active) return false;
      return hasPerm(member.permsByCampus, perm, campusId === undefined ? a.campusId : campusId);
    },
    require(perm, campusId) {
      if (!ctx.can(perm, campusId)) {
        void ctx.audit({ action: 'permission.denied', reason: perm, campusId: campusId ?? a.campusId ?? null, result: 'denied' });
        denied();
      }
    },
    campusesFor(perm) {
      if (platformAdmin) return ['*'];
      return active ? campusesWithPerm(member?.permsByCampus, perm) : [];
    },
    allowedClassIds() {
      if (!member || member.kind === 'owner') return null;
      const grants = (member.grants ?? []).filter((g) => {
        if (g.validFrom && new Date(g.validFrom) > now) return false;
        if (g.validTo && new Date(g.validTo) < now) return false;
        return g.roleId === 'teacher';
      });
      if (!grants.length) return null; // không phải giáo viên → không hạn chế theo lớp
      if (grants.some((g) => !g.classIds || g.classIds.length === 0)) return null;
      return [...new Set(grants.flatMap((g) => g.classIds ?? []))];
    },
    async audit(e: AuditEntry) {
      try {
        await db.collection(orgPath('auditLogs')).add({
          at: ts(),
          actorUid: a.uid,
          actorName: member?.displayName ?? (a.token.name as string | undefined) ?? a.uid,
          campusId: e.campusId ?? a.campusId ?? null,
          action: e.action,
          collection: e.collection ?? null,
          docId: e.docId ?? null,
          before: e.before ?? null,
          after: e.after ?? null,
          reason: e.reason ?? null,
          result: e.result ?? 'ok',
          requestId,
        });
      } catch (err) {
        console.error('audit failed', err);
      }
    },
    metaCreate: () => ({ createdAt: ts(), updatedAt: ts(), createdBy: a.uid, updatedBy: a.uid, version: 1 }),
    metaUpdate: (prev) => ({ updatedAt: ts(), updatedBy: a.uid, version: prev + 1 }),
    tx: <T>(fn: (t: Transaction) => Promise<T>) => db.runTransaction(fn),
  };
  return ctx;
}

export { FieldValue, Timestamp, fail };
