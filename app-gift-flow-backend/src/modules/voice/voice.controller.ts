import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VoiceSegmentDto, VoiceSegmentUploadDto } from './voice.dto';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  /** Upload 1 lượt nói (1 phong bì). Idempotent theo request_id. */
  @Post('segments')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: VoiceSegmentUploadDto })
  @UseInterceptors(FileInterceptor('audio'))
  segment(
    @CurrentUser() u: AuthUser,
    @Body() dto: VoiceSegmentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.voice.processSegment(u.id, dto, file);
  }

  @Get('jobs/:id')
  job(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.getJob(u.id, id);
  }
}
