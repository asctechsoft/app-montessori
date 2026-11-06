import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { AppConfig, CONFIG } from '../../config/config';
import { VoiceJob } from '../../database/entities';
import { AiModule } from '../ai/ai.module';
import { EventsModule } from '../events/events.module';
import { GiftsModule } from '../gifts/gifts.module';
import { QuotasModule } from '../quotas/quotas.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VoiceJob]),
    AiModule,
    EventsModule,
    GiftsModule,
    QuotasModule,
    MulterModule.registerAsync({
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({
        storage: memoryStorage(), // không ghi audio xuống đĩa (mặc định không lưu audio)
        limits: { fileSize: cfg.maxAudioBytes, files: 1, fields: 10 },
      }),
    }),
  ],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
