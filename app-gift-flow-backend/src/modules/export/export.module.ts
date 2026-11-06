import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExportJob, Gift } from '../../database/entities';
import { EventsModule } from '../events/events.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExportJob, Gift]), EventsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
