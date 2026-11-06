'use client';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut as fbSignOut,
  sendPasswordResetEmail, type User,
} from 'firebase/auth';
import { firebase } from '@/lib/firebase';
import { callApi, toApiError, ApiError } from '@/lib/api';
import type { Grant, PermsByCampus } from '@/lib/permissions';

export interface MyCampus {
  id: string;
  code?: string;
  name: string;
  status?: string;
  timezone?: string;
}

export interface MyOrg {
  orgId: string;
  name: string;
  status?: string;
  kind: 'owner' | 'staff' | 'parent';
  memberStatus: string;
  displayName?: string;
  roles: string[];
  grants: Grant[];
  permsByCampus: PermsByCampus;
  campuses: MyCampus[];
}

export type AuthStatus = 'loading' | 'signedOut' | 'bootstrapping' | 'ready' | 'error';

interface AuthApi {
  status: AuthStatus;
  user: User | null;
  platformAdmin: boolean;
  orgs: MyOrg[];
  /** Lỗi khi nạp ngữ cảnh sau đăng nhập (vẫn đăng nhập, có thể Thử lại). */
  error: ApiError | null;
  /** Thông báo hiển thị ở trang đăng nhập sau khi bị đăng xuất cưỡng bức (khóa/thu hồi). */
  notice: string | null;
  clearNotice: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  /** Đăng ký tài khoản + tạo tổ chức mới (demo B2B: người tạo thành owner). */
  registerOrg: (input: { displayName: string; email: string; password: string; orgName: string; campus?: { code: string; name: string; address: string } }, opId: string) => Promise<{ orgId: string }>;
  resetPassword: (email: string) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  /** Nạp lại danh sách tổ chức/cơ sở/quyền (vd. sau khi tạo cơ sở). */
  refresh: () => Promise<void>;
  /** Tải lại toàn bộ ngữ cảnh sau lỗi (hiện trạng thái đang tải). */
  retry: () => Promise<void>;
  /** Tài khoản chỉ là phụ huynh: không dùng web quản trị. */
  parentOnly: boolean;
}

const Ctx = createContext<AuthApi | null>(null);

/** Chuẩn hóa kết quả `org.listMine` (backend/functions/src/modules/org.ts). */
function normalizeMine(raw: unknown): { platformAdmin: boolean; orgs: MyOrg[] } {
  const r = (raw ?? {}) as { platformAdmin?: boolean; orgs?: unknown[] };
  const orgs = (Array.isArray(r.orgs) ? r.orgs : []).map((o0) => {
    const o = o0 as Record<string, unknown>;
    return {
      orgId: String(o.orgId ?? ''),
      name: String(o.name ?? 'Tổ chức'),
      status: o.status as string | undefined,
      kind: (o.kind as MyOrg['kind']) ?? 'staff',
      memberStatus: String(o.memberStatus ?? 'active'),
      displayName: o.displayName as string | undefined,
      roles: Array.isArray(o.roles) ? (o.roles as string[]) : [],
      grants: Array.isArray(o.grants) ? (o.grants as Grant[]) : [],
      permsByCampus: (o.permsByCampus as PermsByCampus) ?? {},
      campuses: (Array.isArray(o.campuses) ? (o.campuses as MyCampus[]) : []).map((c) => ({ ...c, name: c.name ?? c.id })),
    } satisfies MyOrg;
  });
  return { platformAdmin: !!r.platformAdmin, orgs: orgs.filter((o) => o.orgId) };
}

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
  'auth/wrong-password': 'Email hoặc mật khẩu không đúng.',
  'auth/user-not-found': 'Email hoặc mật khẩu không đúng.',
  'auth/invalid-email': 'Email chưa đúng định dạng.',
  'auth/user-disabled': 'Tài khoản đã bị khóa. Liên hệ quản trị tổ chức của bạn.',
  'auth/too-many-requests': 'Đăng nhập sai quá nhiều lần. Hãy đợi ít phút hoặc đặt lại mật khẩu.',
  'auth/network-request-failed': 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  'auth/email-already-in-use': 'Email này đã có tài khoản. Hãy đăng nhập hoặc dùng quên mật khẩu.',
  'auth/weak-password': 'Mật khẩu cần tối thiểu 6 ký tự.',
};

/** Lỗi Firebase Auth -> ApiError tiếng Việt (field `email` / `password` khi phù hợp). */
export function toAuthError(e: unknown): ApiError {
  const code = (e as { code?: string })?.code ?? '';
  if (code.startsWith('auth/')) {
    const msg = AUTH_MESSAGES[code] ?? 'Không thực hiện được. Vui lòng thử lại.';
    const fieldErrors: Record<string, string> = {};
    if (code === 'auth/invalid-email' || code === 'auth/email-already-in-use') fieldErrors.email = msg;
    if (code === 'auth/weak-password') fieldErrors.password = msg;
    return new ApiError(code === 'auth/network-request-failed' ? 'NETWORK' : 'UNAUTHENTICATED', msg, fieldErrors);
  }
  return toApiError(e);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parentOnly, setParentOnly] = useState(false);
  const registering = useRef(false);
  const claimed = useRef<string | null>(null);

  const clearLocal = useCallback(() => {
    setOrgs([]);
    setPlatformAdmin(false);
    setError(null);
    claimed.current = null;
    try {
      Object.keys(window.localStorage).filter((k) => k.startsWith('mn.')).forEach((k) => window.localStorage.removeItem(k));
    } catch {
      /* localStorage không khả dụng */
    }
  }, []);

  const signOut = useCallback(async (msg?: string) => {
    clearLocal();
    if (msg) setNotice(msg);
    await fbSignOut(firebase().auth);
  }, [clearLocal]);

  const loadContext = useCallback(async (claim: boolean, silent = false) => {
    if (!silent) setStatus('bootstrapping');
    setError(null);
    try {
      // Sau mỗi lần đăng nhập: nhận lời mời đang chờ (khớp email/SĐT đã xác minh), rồi nạp ngữ cảnh.
      if (claim) {
        try {
          await callApi('invite.claimPending');
        } catch (e) {
          const err = toApiError(e);
          if (err.code === 'UNAUTHENTICATED') throw err; // các lỗi khác không chặn việc vào hệ thống
        }
      }
      const mine = normalizeMine(await callApi('org.listMine'));
      const active = mine.orgs.filter((o) => o.memberStatus === 'active' && o.status !== 'suspended');
      if (mine.orgs.length > 0 && active.length === 0 && !mine.platformAdmin) {
        const revoked = mine.orgs.some((o) => o.memberStatus === 'revoked');
        await signOut(revoked ? 'Quyền truy cập của bạn đã bị thu hồi. Liên hệ quản trị tổ chức nếu cần dùng lại.' : 'Tài khoản của bạn đang bị tạm khóa hoặc tổ chức đang tạm ngừng. Liên hệ quản trị tổ chức.');
        return;
      }
      setPlatformAdmin(mine.platformAdmin);
      const staffOrgs = active.filter((o) => o.kind !== 'parent'); // web quản trị: phụ huynh dùng ứng dụng di động
      setParentOnly(staffOrgs.length === 0 && active.length > 0);
      setOrgs(staffOrgs);
      setStatus('ready');
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'UNAUTHENTICATED') {
        await signOut('Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.');
        return;
      }
      if (silent) return; // làm mới nền thất bại: giữ ngữ cảnh hiện có
      setError(err);
      setStatus('error');
    }
  }, [signOut]);

  useEffect(() => {
    return onAuthStateChanged(firebase().auth, (u) => {
      setUser(u);
      if (!u) {
        clearLocal();
        setStatus('signedOut');
        return;
      }
      if (registering.current) return; // registerOrg tự nạp ngữ cảnh sau org.create
      if (claimed.current === u.uid) return;
      claimed.current = u.uid;
      void loadContext(true);
    });
  }, [clearLocal, loadContext]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setNotice(null);
      await signInWithEmailAndPassword(firebase().auth, email.trim(), password);
    } catch (e) {
      throw toAuthError(e);
    }
  }, []);

  const registerOrg: AuthApi['registerOrg'] = useCallback(async (input, opId) => {
    registering.current = true;
    try {
      const auth = firebase().auth;
      let created = false;
      if (!auth.currentUser) {
        const cred = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password).catch((e) => {
          throw toAuthError(e);
        });
        created = true;
        await updateProfile(cred.user, { displayName: input.displayName.trim() }).catch(() => undefined);
        await cred.user.getIdToken(true);
      }
      const res = await callApi<{ orgId: string }>('org.create', {
        opId,
        payload: { name: input.orgName.trim(), ...(input.campus ? { ownerCampus: input.campus } : {}) },
      }).catch(async (e) => {
        // Tài khoản đã tạo nhưng tạo tổ chức lỗi: giữ phiên để người dùng thử lại (form giữ dữ liệu).
        if (created) claimed.current = auth.currentUser?.uid ?? null;
        throw e;
      });
      claimed.current = auth.currentUser?.uid ?? null;
      await loadContext(false);
      return res;
    } finally {
      registering.current = false;
    }
  }, [loadContext]);

  const resetPassword = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(firebase().auth, email.trim());
    } catch (e) {
      throw toAuthError(e);
    }
  }, []);

  const refresh = useCallback(() => loadContext(false, true), [loadContext]);

  const value = useMemo<AuthApi>(
    () => ({ status, user, platformAdmin, orgs, error, notice, clearNotice: () => setNotice(null), signIn, registerOrg, resetPassword, signOut, refresh, retry: () => loadContext(false), parentOnly }),
    [status, user, platformAdmin, orgs, error, notice, signIn, registerOrg, resetPassword, signOut, refresh, loadContext, parentOnly],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth cần AuthProvider');
  return c;
}
