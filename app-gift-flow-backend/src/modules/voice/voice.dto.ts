import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class VoiceSegmentDto {
  @ApiProperty() @IsUUID() event_id: string;

  @ApiProperty({ description: 'UUID client sinh; gửi lại cùng request_id sẽ KHÔNG tạo bản ghi thứ 2' })
  @IsUUID()
  request_id: string;

  @ApiProperty({ description: 'Độ dài audio (ms)' })
  @Type(() => Number)
  @IsInt()
  @Min(300)
  @Max(120_000)
  duration_ms: number;

  @ApiPropertyOptional({ enum: ['mine', 'parents'], description: 'Nhóm khách của phiên ghi' })
  @IsOptional()
  @IsIn(['mine', 'parents'])
  side?: string;

  @ApiPropertyOptional({ description: 'Chỉ có tác dụng khi AI_PROVIDER=mock (dev/test)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  transcript_hint?: string;

}

/** Chỉ dùng cho tài liệu Swagger (file nằm ở multipart, không nằm trong body DTO). */
export class VoiceSegmentUploadDto extends VoiceSegmentDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'file audio m4a/wav/ogg/webm/mp3' })
  declare audio: unknown;
}
