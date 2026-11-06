import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsISO8601, IsOptional } from 'class-validator';

export const EXPORT_COLUMNS = ['guest', 'amount', 'relationship', 'note', 'status', 'created_at', 'side'];

export class CreateExportDto {
  @ApiPropertyOptional({ enum: EXPORT_COLUMNS, isArray: true, default: ['guest', 'amount', 'relationship'] })
  @IsOptional()
  @IsArray()
  @IsIn(EXPORT_COLUMNS, { each: true })
  columns?: string[];

  @ApiPropertyOptional({ default: false, description: 'Gồm bản ghi chờ xác nhận (có cột trạng thái, không cộng vào tổng)' })
  @IsOptional()
  @IsBoolean()
  include_pending?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
