import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateExportDto } from './export.dto';
import { ExportService } from './export.service';

@ApiTags('export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1')
export class ExportController {
  constructor(private readonly exp: ExportService) {}

  @Post('events/:id/exports')
  create(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateExportDto) {
    return this.exp.create(u.id, id, dto);
  }

  @Get('exports/:id')
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const job = await this.exp.resolveDownload(u.id, id);
    res.download(job.filePath, job.fileName);
  }
}
