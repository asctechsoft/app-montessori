import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { GoogleAuthDto, GuestAuthDto, RefreshDto } from './auth.dto';
import { AuthUser, CurrentUser, JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('v1')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  @Post('auth/guest')
  @HttpCode(200)
  @Throttle({ default: { limit: () => Number(process.env.THROTTLE_GUEST_LIMIT ?? 10), ttl: 60_000 } })
  guest(@Body() dto: GuestAuthDto) {
    return this.auth.guest(dto.device_id);
  }

  /** Gửi kèm Authorization (guest) để gộp dữ liệu guest vào tài khoản Google. */
  @Post('auth/google')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async google(@Body() dto: GoogleAuthDto, @Headers('authorization') authz?: string) {
    let guestId: string | undefined;
    const token = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : undefined;
    if (token) {
      try {
        const p = await this.jwt.verifyAsync<{ sub: string; typ: string }>(token);
        if (p.typ === 'access') guestId = p.sub;
      } catch {
        /* token guest hết hạn: bỏ qua, chỉ đăng nhập */
      }
    }
    return this.auth.loginGoogle(dto.id_token, guestId);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.rotate(dto.refresh_token);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
