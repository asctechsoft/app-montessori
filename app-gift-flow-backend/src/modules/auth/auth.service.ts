import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AppError } from '../../common/app-error';
import { AppConfig, CONFIG } from '../../config/config';
import { ExportJob, Gift, GiftEvent, RefreshToken, User, VoiceJob } from '../../database/entities';
import { GoogleTokenVerifier } from './google-verifier';
import { QuotasService } from '../quotas/quotas.service';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refresh: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly quotas: QuotasService,
    private readonly google: GoogleTokenVerifier,
    private readonly ds: DataSource,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Guest auth: định danh thiết bị (hash) -> user ẩn danh có quota riêng. */
  async guest(deviceId: string): Promise<TokenPair> {
    const providerUserId = sha256(`guest:${deviceId}`);
    let user = await this.users.findOne({ where: { authProvider: 'guest', providerUserId } });
    if (!user) {
      try {
        user = await this.users.save(
          this.users.create({ authProvider: 'guest', providerUserId, displayName: null, plan: 'free' }),
        );
      } catch {
        // 2 request đồng thời cùng thiết bị: unique constraint -> lấy bản đã tạo
        user = await this.users.findOneOrFail({ where: { authProvider: 'guest', providerUserId } });
      }
    }
    return this.issue(user.id);
  }

  /**
   * Đăng nhập Google. Nếu request có token guest hợp lệ, toàn bộ dữ liệu của guest
   * (sự kiện, tiền mừng...) được GỘP sang tài khoản Google (không nhân đôi, id giữ nguyên).
   */
  async loginGoogle(idToken: string, guestUserId?: string): Promise<TokenPair & { display_name: string | null }> {
    const ident = await this.google.verify(idToken);
    let user = await this.users.findOne({ where: { authProvider: 'google', providerUserId: ident.sub } });
    if (!user) {
      try {
        user = await this.users.save(
          this.users.create({
            authProvider: 'google',
            providerUserId: ident.sub,
            displayName: ident.name ?? null,
            plan: 'free',
          }),
        );
      } catch {
        user = await this.users.findOneOrFail({ where: { authProvider: 'google', providerUserId: ident.sub } });
      }
    }
    if (guestUserId && guestUserId !== user.id) {
      const guest = await this.users.findOne({ where: { id: guestUserId, authProvider: 'guest' } });
      if (guest) await this.mergeGuest(guest.id, user.id);
    }
    return { ...(await this.issue(user.id)), display_name: user.displayName };
  }

  private async mergeGuest(fromId: string, toId: string): Promise<void> {
    await this.ds.transaction(async (m) => {
      for (const entity of [GiftEvent, Gift, VoiceJob, ExportJob]) {
        await m.getRepository(entity).update({ ownerId: fromId } as any, { ownerId: toId } as any);
      }
      await m.getRepository(RefreshToken).update({ userId: fromId, revokedAt: IsNull() }, { revokedAt: new Date() });
    });
  }

  /** Refresh token xoay vòng: mỗi token dùng một lần; dùng lại token cũ => thu hồi tất cả. */
  async rotate(token: string): Promise<TokenPair> {
    const row = await this.refresh.findOne({ where: { tokenHash: sha256(token) } });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new AppError(401, 'unauthorized', 'Refresh token không hợp lệ');
    }
    if (row.revokedAt) {
      await this.refresh.update({ userId: row.userId, revokedAt: IsNull() }, { revokedAt: new Date() });
      throw new AppError(401, 'token_reuse', 'Phiên đăng nhập không còn hiệu lực');
    }
    // Thu hồi có điều kiện để 2 request đồng thời không cùng đổi được 1 token.
    const res = await this.refresh.update({ id: row.id, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!res.affected) throw new AppError(401, 'token_reuse', 'Phiên đăng nhập không còn hiệu lực');
    return this.issue(row.userId);
  }

  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new AppError(401, 'unauthorized', 'Tài khoản không tồn tại');
    const quota = await this.quotas.snapshot(userId);
    return { id: user.id, display_name: user.displayName, plan: user.plan, quota };
  }

  private async issue(userId: string): Promise<TokenPair> {
    const access = await this.jwt.signAsync({ sub: userId, typ: 'access' });
    const raw = randomBytes(48).toString('base64url');
    await this.refresh.save(
      this.refresh.create({
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + this.cfg.refreshTtlDays * 86_400_000),
        revokedAt: null,
      }),
    );
    return { access_token: access, refresh_token: raw, token_type: 'Bearer', expires_in: this.cfg.jwtAccessTtl };
  }
}
