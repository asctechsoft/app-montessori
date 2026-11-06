import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../../common/app-error';

export interface AuthUser {
  id: string;
}

/** Bearer JWT -> req.user. Mọi route dữ liệu đều đi qua guard này (owner scope). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new AppError(401, 'unauthorized', 'Thiếu token đăng nhập');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(token);
      if (payload.typ !== 'access' || !payload.sub) throw new Error('bad token type');
      req.user = { id: payload.sub } satisfies AuthUser;
      return true;
    } catch {
      throw new AppError(401, 'unauthorized', 'Token không hợp lệ hoặc đã hết hạn');
    }
  }
}

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user,
);
