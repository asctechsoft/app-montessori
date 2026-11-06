import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const EVENT_TYPES = ['wedding', 'engagement', 'housewarming', 'other'];
export const EVENT_STATUSES = ['active', 'closed'];

export class CreateEventDto {
  @ApiPropertyOptional({ description: 'UUID do client sinh (idempotent); bỏ trống để server sinh' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;

  @ApiPropertyOptional({ enum: EVENT_TYPES })
  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: string;

  @ApiProperty({ example: '2026-05-24' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'event_date phải dạng YYYY-MM-DD' })
  event_date: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) location?: string | null;

  @ApiPropertyOptional({ enum: EVENT_STATUSES })
  @IsOptional()
  @IsIn(EVENT_STATUSES)
  status?: string;
}

/** PUT /v1/events/:id (upsert idempotent cho đồng bộ local-first). */
export class UpsertEventDto extends CreateEventDto {
  @ApiPropertyOptional({ description: 'Thời điểm sửa ở client; bản cũ hơn bản server sẽ bị bỏ (LWW)' })
  @IsOptional()
  @IsISO8601()
  updated_at?: string;
}

export class PatchEventDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsIn(EVENT_TYPES) type?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) event_date?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string | null;
  @IsOptional() @IsIn(EVENT_STATUSES) status?: string;
}
