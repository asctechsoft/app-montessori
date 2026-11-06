import { HttpsError } from 'firebase-functions/v2/https';

export type ErrCode =
  | 'PERMISSION_DENIED' | 'UNAUTHENTICATED' | 'NOT_FOUND' | 'VALIDATION' | 'VERSION_CONFLICT'
  | 'CONFLICT' | 'PRECONDITION' | 'INVALID_STATE' | 'LIMIT' | 'INTERNAL';

const GRPC: Record<ErrCode, 'permission-denied' | 'unauthenticated' | 'not-found' | 'invalid-argument' | 'aborted' | 'already-exists' | 'failed-precondition' | 'resource-exhausted' | 'internal'> = {
  PERMISSION_DENIED: 'permission-denied',
  UNAUTHENTICATED: 'unauthenticated',
  NOT_FOUND: 'not-found',
  VALIDATION: 'invalid-argument',
  VERSION_CONFLICT: 'aborted',
  CONFLICT: 'already-exists',
  PRECONDITION: 'failed-precondition',
  INVALID_STATE: 'failed-precondition',
  LIMIT: 'resource-exhausted',
  INTERNAL: 'internal',
};

/** Lỗi nghiệp vụ chuẩn: message tiếng Việt cho người dùng, details.code cho client. */
export function fail(code: ErrCode, message: string, extra: Record<string, unknown> = {}): never {
  throw new HttpsError(GRPC[code], message, { code, ...extra });
}

export function denied(message = 'Bạn không có quyền thực hiện thao tác này.'): never {
  return fail('PERMISSION_DENIED', message);
}

export function invalid(fieldErrors: Record<string, string>, message = 'Dữ liệu chưa hợp lệ.'): never {
  return fail('VALIDATION', message, { fieldErrors });
}
