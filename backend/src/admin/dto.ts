import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssueStatus, ISSUE_CATEGORIES, Role } from '@civiclens/contracts';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const page = () => ({ limit: 20, offset: 0 });
const emptyToUndefined = () => Transform(({ value }) => value === '' ? undefined : value);

export class AdminIssuesQuery {
  @ApiPropertyOptional({ enum: IssueStatus }) @IsOptional() @IsEnum(IssueStatus) status?: IssueStatus;
  @ApiPropertyOptional({ enum: ISSUE_CATEGORIES }) @IsOptional() @IsIn(ISSUE_CATEGORIES as unknown as string[]) category?: string;
  @ApiPropertyOptional({ description: 'Only open reports the system flagged as possible duplicates' })
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() flagged?: boolean;
  @ApiPropertyOptional({ description: 'Title contains (case-insensitive)' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ description: 'Exact report UUID' }) @emptyToUndefined() @IsOptional() @IsUUID() reportId?: string;
  @ApiPropertyOptional({ description: 'Reports created on or after this ISO-8601 date' }) @emptyToUndefined() @IsOptional() @IsDateString() createdFrom?: string;
  @ApiPropertyOptional({ description: 'Reports created before this ISO-8601 date' }) @emptyToUndefined() @IsOptional() @IsDateString() createdTo?: string;
  @ApiPropertyOptional({ description: 'Latitude for the location-radius filter', minimum: -90, maximum: 90 })
  @emptyToUndefined() @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional({ description: 'Longitude for the location-radius filter', minimum: -180, maximum: 180 })
  @emptyToUndefined() @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional({ description: 'Location search radius in metres', minimum: 1, maximum: 50000, default: 1000 })
  @emptyToUndefined() @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(50000) radiusM: number = 1000;
  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'confirmed'], default: 'newest' }) @IsOptional() @IsIn(['newest', 'oldest', 'confirmed']) sort: 'newest' | 'oldest' | 'confirmed' = 'newest';
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = page().limit;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset: number = page().offset;
}

export class UpdateIssueDto {
  @ApiProperty({ enum: ISSUE_CATEGORIES }) @IsIn(ISSUE_CATEGORIES as unknown as string[]) category: string;
}

export class AssignIssueDto {
  @ApiPropertyOptional({ description: 'Active moderator or admin user UUID; null unassigns the report', nullable: true })
  @IsOptional() @IsUUID() assigneeId?: string | null;
}

export class AdminUsersQuery {
  @ApiPropertyOptional({ description: 'Email or display name contains' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: Role }) @IsOptional() @IsEnum(Role) role?: Role;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'DELETED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED', 'DELETED']) status?: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = page().limit;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset: number = page().offset;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: Role }) @IsOptional() @IsEnum(Role) role?: Role;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
}

export class AuditQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) action?: string;
  @ApiPropertyOptional({ description: 'Exact entity UUID' }) @emptyToUndefined() @IsOptional() @IsUUID() entityId?: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = page().limit;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset: number = page().offset;
}