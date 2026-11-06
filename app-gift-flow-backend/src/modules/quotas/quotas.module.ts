import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageQuota } from '../../database/entities';
import { QuotasService } from './quotas.service';

@Module({
  imports: [TypeOrmModule.forFeature([UsageQuota])],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class QuotasModule {}
