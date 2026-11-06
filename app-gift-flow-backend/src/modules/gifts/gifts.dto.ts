import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const GIFT_STATUSES = ['confirmed', 'pending_review'];
export const GIFT_SOURCES = ['voice', 'manual'];
export const GIFT_SIDES = ['mine', 'parents'];
/** Trần cứng ở tầng DTO; trần cấu hình MAX_AMOUNT_VND kiểm lại ở service. */
const HARD_MAX = 2_000_000_000;

export class UpsertGiftDto {
  @ApiProperty() @IsUUID() event_id: string;
  @ApiProperty() @IsString() @MaxLength(200) guest_name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) relationship_label?: string | null;
  @ApiProperty({ description: 'VND nguyên, >0 khi confirmed' })
  @IsInt() @Min(0) @Max(HARD_MAX) amount_vnd: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @ApiProperty({ enum: GIFT_STATUSES }) @IsIn(GIFT_STATUSES) status: string;
  @ApiPropertyOptional({ enum: GIFT_SOURCES }) @IsOptional() @IsIn(GIFT_SOURCES) source?: string;
  @ApiPropertyOptional({ enum: GIFT_SIDES, description: 'mine | parents' }) @IsOptional() @IsIn(GIFT_SIDES) side?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) transcript?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() created_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() updated_at?: string;
}

export class CreateGiftDto {
  @ApiProperty({ description: 'UUID do app sinh - khoá idempotency (BR07)' })
  @IsUUID() client_request_id: string;
  @ApiProperty() @IsString() @MaxLength(200) guest_name: string;
  @ApiProperty() @IsInt() @Min(1) @Max(HARD_MAX) amount_vnd: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) relationship_label?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @ApiPropertyOptional({ enum: GIFT_SIDES }) @IsOptional() @IsIn(GIFT_SIDES) side?: string;
}

export class PatchGiftDto {
  @IsOptional() @IsString() @MaxLength(200) guest_name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(HARD_MAX) amount_vnd?: number;
  @IsOptional() @IsString() @MaxLength(100) relationship_label?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsOptional() @IsIn(GIFT_STATUSES) status?: string;
  @IsOptional() @IsIn(GIFT_SIDES) side?: string;
}

export class ConfirmGiftDto {
  @IsOptional() @IsString() @MaxLength(200) guest_name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(HARD_MAX) amount_vnd?: number;
  @IsOptional() @IsString() @MaxLength(100) relationship_label?: string | null;
}

export class ListGiftsQuery {
  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ description: 'Tìm theo tên/quan hệ/ghi chú, không phân biệt dấu' })
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: GIFT_STATUSES }) @IsOptional() @IsIn(GIFT_STATUSES) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) relationship?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) include_deleted?: string;
  @ApiPropertyOptional({ enum: GIFT_SIDES }) @IsOptional() @IsIn(GIFT_SIDES) side?: string;
}
