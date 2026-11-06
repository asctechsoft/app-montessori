import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Gắn correlation id (client gửi x-correlation-id, hoặc tự sinh). */
export function requestIdMiddleware(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
  const incoming = req.header('x-correlation-id');
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
