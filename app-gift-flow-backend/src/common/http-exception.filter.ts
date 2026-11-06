import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'validation_error',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'rate_limited',
  502: 'provider_error',
  503: 'unavailable',
};

/** Mọi lỗi trả cùng một hình dạng: {code, message, request_id, details?}. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Lỗi máy chủ';
    let details: unknown;

    if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'rate_limited';
      message = 'Bạn thao tác quá nhanh, hãy thử lại sau';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      code = body?.code ?? CODE_BY_STATUS[status] ?? 'error';
      if (typeof body === 'string') {
        message = body;
      } else if (Array.isArray(body?.message)) {
        // class-validator: danh sách lỗi trường
        message = 'Dữ liệu không hợp lệ';
        details = body.message;
      } else {
        message = body?.message ?? exception.message;
        details = body?.details;
      }
    } else if ((exception as any)?.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'payload_too_large';
      message = 'Tệp âm thanh quá lớn';
    } else {
      // Không lộ chi tiết nội bộ ra client.
      this.log.error(
        `[${requestId}] ${req.method} ${req.url} -> ${(exception as Error)?.stack ?? exception}`,
      );
    }

    if (status >= 500 && status !== 502 && status !== 503) {
      message = 'Lỗi máy chủ';
      details = undefined;
    }
    res.status(status).json({ code, message, request_id: requestId, ...(details ? { details } : {}) });
  }
}
