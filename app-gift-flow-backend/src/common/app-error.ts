import { HttpException } from '@nestjs/common';

/** Lỗi nghiệp vụ có mã ổn định cho client: {code, message, request_id, details?}. */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const notFound = (what = 'Không tìm thấy') => new AppError(404, 'not_found', what);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
