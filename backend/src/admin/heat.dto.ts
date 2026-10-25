import { ApiPropertyOptional } from '@nestjs/swagger';
import { ISSUE_CATEGORIES } from '@civiclens/contracts';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class HeatmapQuery {
  @ApiPropertyOptional({ enum: ['open', 'resolved', 'all'], default: 'open' })
  @IsOptional() @IsIn(['open', 'resolved', 'all']) scope: 'open' | 'resolved' | 'all' = 'open';

  @ApiPropertyOptional({ description: 'Only reports created in the last N days. 0 = all time.', default: 0, maximum: 365 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) days: number = 0;

  @ApiPropertyOptional({ enum: ISSUE_CATEGORIES })
  @IsOptional() @IsIn(ISSUE_CATEGORIES as unknown as string[]) category?: string;

  @ApiPropertyOptional({ description: 'Map zoom level — chooses the grid cell size', default: 12 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(19) zoom: number = 12;
}