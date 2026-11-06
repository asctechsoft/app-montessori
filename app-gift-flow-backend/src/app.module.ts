import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, CONFIG, loadConfig } from './config/config';
import { buildDataSourceOptions } from './database/database.config';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { EventsModule } from './modules/events/events.module';
import { ExportModule } from './modules/export/export.module';
import { GiftsModule } from './modules/gifts/gifts.module';
import { HealthModule } from './modules/health/health.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { VoiceModule } from './modules/voice/voice.module';

@Global()
@Module({})
export class ConfigGlobalModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return {
      module: ConfigGlobalModule,
      providers: [{ provide: CONFIG, useValue: cfg }],
      exports: [CONFIG],
    };
  }
}

@Module({})
export class AppModule {
  /** Cho phép test truyền cấu hình riêng (DB in-memory, mock AI...). */
  static forRoot(cfg: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigGlobalModule.forRoot(cfg),
        TypeOrmModule.forRoot(buildDataSourceOptions(cfg)),
        ThrottlerModule.forRoot([{ ttl: cfg.throttleTtl * 1000, limit: cfg.throttleLimit }]),
        AuditModule,
        QuotasModule,
        AuthModule,
        EventsModule,
        GiftsModule,
        VoiceModule,
        StatisticsModule,
        ExportModule,
        HealthModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    };
  }
}
