import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig, CONFIG } from '../../config/config';
import { Gift, GiftEvent, VoiceJob, ExportJob, RefreshToken, User } from '../../database/entities';
import { QuotasModule } from '../quotas/quotas.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleTokenVerifier } from './google-verifier';
import { JwtAuthGuard } from './jwt-auth.guard';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, GiftEvent, Gift, VoiceJob, ExportJob]),
    QuotasModule,
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({
        secret: cfg.jwtAccessSecret,
        signOptions: { algorithm: 'HS256', expiresIn: cfg.jwtAccessTtl },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, GoogleTokenVerifier],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
