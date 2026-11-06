'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { safeOnSnapshot } from '@/lib/hooks/useFirestore';
import { firebase } from '@/lib/firebase';
import { useAuth, type MyCampus, type MyOrg } from './AuthProvider';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import {
  computePermsByCampus, hasPerm, hasPermAnywhere, SYSTEM_ROLES, SYSTEM_ROLE_LABELS, type PermsByCampus,
} from '@/lib/permissions';
import { DEFAULT_TZ } from '@/lib/format';

export interface AcademicYearOption {
  id: string;
  name: string;
}

export interface RoleOption {
  id: string;
  label: string;
}

interface ScopeApi {
  org: MyOrg | null;
  orgs: MyOrg[];
  /** Cơ sở người dùng được thao tác trong tổ chức hiện tại. */
  campuses: MyCampus[];
  /** Cơ sở đang thao tác: id hoặc 'all' (chỉ khi có quyền cấp tổ chức). */
  campusId: string | 'all' | null;
  campus: MyCampus | null;
  canSelectAll: boolean;
  tz: string;
  years: AcademicYearOption[];
  yearId: string | null;
  /** Vai trò đang dùng ('all' = hợp tất cả vai trò). Chỉ là góc nhìn giao diện; máy chủ vẫn kiểm tra quyền. */
  roleId: string | 'all';
  roleOptions: RoleOption[];
  /** Khóa thay đổi khi đổi tổ chức/cơ sở/năm học: dùng làm key cho useFirestoreQuery để tải lại dữ liệu. */
  scopeKey: string;
  perms: PermsByCampus;
  /** Có quyền ở cơ sở đang chọn (hoặc quyền cấp tổ chức). Khi 'all': chỉ quyền cấp tổ chức. */
  can: (perm: string, campusId?: string | null) => boolean;
  canAnywhere: (perm: string) => boolean;
  /** Quyền cấp tổ chức (khóa '*'). */
  canOrg: (perm: string) => boolean;
  /** Mỗi hàm trả false nếu người dùng chọn Ở lại khi có biểu mẫu chưa lưu. */
  selectOrg: (orgId: string) => Promise<boolean>;
  selectCampus: (campusId: string | 'all') => Promise<boolean>;
  selectYear: (yearId: string) => Promise<boolean>;
  selectRole: (roleId: string | 'all') => Promise<boolean>;
}

const Ctx = createContext<ScopeApi | null>(null);
const STORE_KEY = 'mn.scope.v1';

interface Stored {
  orgId?: string;
  campusId?: string;
  yearId?: string;
  roleId?: string;
}

function readStored(): Stored {
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { orgs, user, signOut, status } = useAuth();
  const { confirmDiscard } = useDirtyGuard();
  const [sel, setSel] = useState<Stored>({});
  const [livePerms, setLivePerms] = useState<{ orgId: string; perms: PermsByCampus } | null>(null);
  const [years, setYears] = useState<AcademicYearOption[]>([]);
  const [customRoles, setCustomRoles] = useState<Record<string, { name: string; perms: string[] }>>({});
  const [hydrated, setHydrated] = useState(false);

  // localStorage chỉ nhớ lựa chọn gần nhất. KHÔNG phải căn cứ cấp quyền: luôn đối chiếu với danh sách do máy chủ trả.
  useEffect(() => {
    setSel(readStored());
    setHydrated(true);
  }, []);

  const org = useMemo(() => orgs.find((o) => o.orgId === sel.orgId) ?? orgs[0] ?? null, [orgs, sel.orgId]);

  const basePerms = useMemo<PermsByCampus>(() => {
    if (!org) return {};
    return livePerms && livePerms.orgId === org.orgId ? livePerms.perms : org.permsByCampus;
  }, [org, livePerms]);

  // Theo dõi hồ sơ thành viên: đổi quyền có hiệu lực ngay; bị khóa/thu hồi => đăng xuất, xóa cache.
  useEffect(() => {
    if (!org || !user || status !== 'ready') return;
    const ref = doc(firebase().db, 'orgs', org.orgId, 'members', user.uid);
    return safeOnSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (d.status === 'revoked') void signOut('Quyền truy cập của bạn đã bị thu hồi.');
        else if (d.status === 'suspended') void signOut('Tài khoản của bạn đã bị tạm khóa.');
        else if (d.permsByCampus) setLivePerms({ orgId: org.orgId, perms: d.permsByCampus as PermsByCampus });
      },
      () => undefined,
    );
  }, [org, user, status, signOut]);

  // Vai trò tùy biến (để thu hẹp theo vai trò đang dùng); bỏ qua nếu không đọc được.
  useEffect(() => {
    setCustomRoles({});
    if (!org || !hasPermAnywhere(basePerms, 'members.read')) return;
    return safeOnSnapshot(
      collection(firebase().db, 'orgs', org.orgId, 'roles'),
      (snap) => setCustomRoles(Object.fromEntries(snap.docs.map((d) => [d.id, { name: String(d.data().name ?? d.id), perms: (d.data().perms as string[]) ?? [] }]))),
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.orgId]);

  const roleOptions = useMemo<RoleOption[]>(() => {
    const ids = [...new Set((org?.grants ?? []).map((g) => g.roleId))];
    return ids.map((id) => ({ id, label: SYSTEM_ROLE_LABELS[id] ?? customRoles[id]?.name ?? id }));
  }, [org, customRoles]);

  const roleId: string | 'all' = sel.roleId && roleOptions.some((r) => r.id === sel.roleId) ? sel.roleId : 'all';

  const perms = useMemo<PermsByCampus>(() => {
    if (roleId === 'all' || !org) return basePerms;
    const custom = Object.fromEntries(Object.entries(customRoles).map(([k, v]) => [k, v.perms]));
    if (!(roleId in SYSTEM_ROLES) && !(roleId in custom)) return basePerms;
    const narrowed = computePermsByCampus(org.grants.filter((g) => g.roleId === roleId), custom, new Date(), org.campuses.map((c) => c.id));
    // Không bao giờ mở rộng hơn quyền máy chủ đã tính.
    const out: PermsByCampus = {};
    for (const [k, list] of Object.entries(narrowed)) out[k] = list.filter((p) => basePerms[k]?.includes(p) || basePerms['*']?.includes(p));
    return out;
  }, [roleId, org, basePerms, customRoles]);

  const campuses = useMemo(() => {
    if (!org) return [];
    if (perms['*'] || org.kind === 'owner') return org.campuses;
    return org.campuses.filter((c) => (perms[c.id] ?? []).length > 0);
  }, [org, perms]);

  const canSelectAll = Object.values(perms['*'] ?? []).length > 0 && campuses.length > 0;

  const campusId: string | 'all' | null = useMemo(() => {
    if (sel.campusId === 'all' && canSelectAll) return 'all';
    if (sel.campusId && campuses.some((c) => c.id === sel.campusId)) return sel.campusId;
    if (canSelectAll) return 'all';
    return campuses[0]?.id ?? null;
  }, [sel.campusId, campuses, canSelectAll]);

  const campus = useMemo(() => (campusId && campusId !== 'all' ? campuses.find((c) => c.id === campusId) ?? null : null), [campusId, campuses]);
  const tz = campus?.timezone || DEFAULT_TZ;

  // Năm học của cơ sở đang chọn.
  useEffect(() => {
    setYears([]);
    if (!org || !campus || !hasPerm(perms, 'campus.read', campus.id)) return;
    const q = query(collection(firebase().db, 'orgs', org.orgId, 'academicYears'), where('campusId', '==', campus.id));
    return safeOnSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .filter((d) => !d.data().archived)
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id), start: String(d.data().startDate ?? d.data().from ?? '') }))
          .sort((a, b) => b.start.localeCompare(a.start));
        setYears(list.map(({ id, name }) => ({ id, name })));
      },
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.orgId, campus?.id]);

  const yearId = sel.yearId && years.some((y) => y.id === sel.yearId) ? sel.yearId : years[0]?.id ?? null;

  const persist = useCallback((next: Stored) => {
    setSel(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* bỏ qua */
    }
  }, []);

  const selectOrg = useCallback(async (orgId: string) => {
    if (orgId === org?.orgId) return true;
    if (!(await confirmDiscard('đổi tổ chức'))) return false;
    persist({ orgId });
    return true;
  }, [org, confirmDiscard, persist]);

  const selectCampus = useCallback(async (id: string | 'all') => {
    if (id === campusId) return true;
    if (!(await confirmDiscard('đổi cơ sở'))) return false;
    persist({ ...sel, orgId: org?.orgId, campusId: id, yearId: undefined });
    return true;
  }, [campusId, confirmDiscard, persist, sel, org]);

  const selectYear = useCallback(async (id: string) => {
    if (id === yearId) return true;
    if (!(await confirmDiscard('đổi năm học'))) return false;
    persist({ ...sel, yearId: id });
    return true;
  }, [yearId, confirmDiscard, persist, sel]);

  const selectRole = useCallback(async (id: string | 'all') => {
    if (id === roleId) return true;
    if (!(await confirmDiscard('đổi vai trò'))) return false;
    persist({ ...sel, roleId: id });
    return true;
  }, [roleId, confirmDiscard, persist, sel]);

  const can = useCallback(
    (perm: string, forCampus?: string | null) => {
      const target = forCampus === undefined ? campusId : forCampus;
      return hasPerm(perms, perm, target === 'all' ? '*' : target);
    },
    [perms, campusId],
  );
  const canAnywhere = useCallback((perm: string) => hasPermAnywhere(perms, perm), [perms]);

  const scopeKey = `${org?.orgId ?? '-'}|${campusId ?? '-'}|${yearId ?? '-'}|${roleId}`;

  const value = useMemo<ScopeApi>(
    () => ({
      org, orgs, campuses, campusId, campus, canSelectAll, tz, years, yearId, roleId, roleOptions, scopeKey, perms,
      can, canAnywhere, canOrg: (p) => hasPerm(perms, p, '*'), selectOrg, selectCampus, selectYear, selectRole,
    }),
    [org, orgs, campuses, campusId, campus, canSelectAll, tz, years, yearId, roleId, roleOptions, scopeKey, perms, can, canAnywhere, selectOrg, selectCampus, selectYear, selectRole],
  );

  // Tránh nhấp nháy lựa chọn mặc định trước khi đọc localStorage.
  if (!hydrated) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScope(): ScopeApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useScope cần ScopeProvider');
  return c;
}

export type { ScopeApi };
