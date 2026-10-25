import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssueStatus, ISSUE_CATEGORIES } from '@civiclens/contracts';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateIssueDto {
  @ApiProperty({ enum: ISSUE_CATEGORIES })
  @IsIn(ISSUE_CATEGORIES as unknown as string[])
  category: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({
    description:
      'Idempotency key generated on the device. Safe to retry with the same value.',
  })
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}

export class NearbyQuery {
  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @ApiPropertyOptional({
    default: 1000,
    maximum: 20000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(20000)
  radius: number = 1000;

  @ApiPropertyOptional({ enum: ISSUE_CATEGORIES })
  @IsOptional()
  @IsIn(ISSUE_CATEGORIES as unknown as string[])
  category?: string;
}

export class MapQuery {
  @ApiProperty({ description: 'west' })
  @Type(() => Number)
  @IsLongitude()
  minLng: number;

  @ApiProperty({ description: 'south' })
  @Type(() => Number)
  @IsLatitude()
  minLat: number;

  @ApiProperty({ description: 'east' })
  @Type(() => Number)
  @IsLongitude()
  maxLng: number;

  @ApiProperty({ description: 'north' })
  @Type(() => Number)
  @IsLatitude()
  maxLat: number;

  @ApiPropertyOptional({ enum: ISSUE_CATEGORIES })
  @IsOptional()
  @IsIn(ISSUE_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ enum: IssueStatus })
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;
}

export class ListQuery {
  @ApiPropertyOptional({ maxLength: 100, description: 'Literal substring search in report titles and descriptions' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ISSUE_CATEGORIES })
  @IsOptional()
  @IsIn(ISSUE_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ enum: IssueStatus })
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;

  @ApiPropertyOptional({
    default: 20,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: IssueStatus }) @IsEnum(IssueStatus) status: IssueStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ description: 'When marking DUPLICATE: the original report. Defaults to the auto-detected candidate.' })
  @IsOptional() @IsUUID() duplicateOfId?: string;
}

export class AddImageDto {
  @ApiProperty({
    description: 'Key returned by POST /uploads/presign',
  })
  @IsString()
  @Matches(
    /^issues\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/,
  )
  key: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  width: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  height: number;
}