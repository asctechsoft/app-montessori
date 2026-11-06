import { httpsCallable } from 'firebase/functions';
import { firebase } from './firebase';

export type ApiErrorCode =
  | 'PERMISSION_DENIED' | 'UNAUTHENTICATED' | 'NOT_FOUND' | 'VALIDATION' | 'VERSION_CONFLICT'
  | 'CONFLICT' | 'PRECONDITION' | 'INVALID_STATE' | 'LIMIT' | 'INTERNAL' | 'NETWORK' | 'UNKNOWN';

/** Lỗi đã chuẩn hóa từ Cloud Function `api` (CONTRACT §4). */
export class ApiError extends Error {
  code: ApiErrorCode;
  fieldErrors: Record<string, string>;
  details: Record<string, unknown>;
  constructor(code: ApiErrorCode, message: string, fieldErrors: Record<string, string> = {}, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.details = details;
  }
}

const GRPC_TO_CODE: Record<string, ApiErrorCode> = {
  'permission-denied': 'PERMISSION_DENIED',
  unauthenticated: 'UNAUTHENTICATED',
  'not-found': 'NOT_FOUND',
  'invalid-argument': 'VALIDATION',
  aborted: 'VERSION_CONFLICT',
  'already-exists': 'CONFLICT',
  'failed-precondition': 'PRECONDITION',
  'resource-exhausted': 'LIMIT',
  internal: 'INTERNAL',
  unavailable: 'NETWORK',
  'deadline-exceeded': 'NETWORK',
};

const DEFAULT_MESSAGE: Partial<Record<ApiErrorCode, string>> = {
  NETWORK: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  PERMISSION_DENIED: 'Bạn không có quyền thực hiện thao tác này.',
  VERSION_CONFLICT: 'Dữ liệu đã được người khác thay đổi. Hãy tải lại rồi đối chiếu trước khi lưu.',
  INTERNAL: 'Hệ thống gặp lỗi. Vui lòng thử lại.',
  NOT_FOUND: 'Máy chủ chưa hỗ trợ thao tác này hoặc không tìm thấy dữ liệu.',
  UNKNOWN: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
};

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const err = e as { code?: string; message?: string; details?: unknown } | null;
  const raw = String(err?.code ?? '').replace(/^functions\//, '');
  const details = (err?.details && typeof err.details === 'object' ? err.details : {}) as Record<string, unknown>;
  const code: ApiErrorCode = (typeof details.code === 'string' ? (details.code as ApiErrorCode) : GRPC_TO_CODE[raw]) ?? 'UNKNOWN';
  const fieldErrors = (details.fieldErrors && typeof details.fieldErrors === 'object' ? details.fieldErrors : {}) as Record<string, string>;
  // Thông điệp từ máy chủ là tiếng Việt; chỉ dùng mặc định khi là lỗi tầng mạng/SDK.
  const m = typeof err?.message === 'string' ? err.message : '';
  const serverMsg = m && !/^(internal|unavailable|deadline|functions\/|failed to fetch|network)/i.test(m) ? m : '';
  const fromServer = typeof details.code === 'string' || raw === 'not-found';
  return new ApiError(code, (fromServer && serverMsg) || DEFAULT_MESSAGE[code] || DEFAULT_MESSAGE.UNKNOWN!, fieldErrors, details);
}

export interface CallApiInput<P = unknown> {
  orgId?: string;
  campusId?: string;
  payload?: P;
  /** UUID chống gửi trùng cho thao tác ghi quan trọng. */
  opId?: string;
}

/** Gọi callable `api` (region asia-southeast1). Ném ApiError khi lỗi. */
export async function callApi<R = unknown, P = unknown>(action: string, input: CallApiInput<P> = {}): Promise<R> {
  try {
    const fn = httpsCallable<unknown, { ok: boolean; data: R }>(firebase().functions, 'api');
    const res = await fn({ action, orgId: input.orgId, campusId: input.campusId, payload: input.payload ?? {}, opId: input.opId });
    return res.data.data;
  } catch (e) {
    throw toApiError(e);
  }
}

export function newOpId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'op-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
