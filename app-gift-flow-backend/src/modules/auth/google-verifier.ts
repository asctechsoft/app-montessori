import { Inject, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../../common/app-error';
import { AppConfig, CONFIG } from '../../config/config';

export interface GoogleIdentity {
  sub: string;
  email?: string;
  name?: string;
}

/** Xác thực Google ID token phía server (audience = client id đã cấu hình). */
@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (!this.cfg.googleClientIds.length) {
      throw new AppError(503, 'google_not_configured', 'Đăng nhập Google chưa được cấu hình (GOOGLE_CLIENT_IDS)');
    }
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.cfg.googleClientIds });
      const p = ticket.getPayload();
      if (!p?.sub) throw new Error('no sub');
      return { sub: p.sub, email: p.email, name: p.name };
    } catch {
      throw new AppError(401, 'invalid_google_token', 'Google token không hợp lệ');
    }
  }
}
