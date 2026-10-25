import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';

import { randomUUID } from 'crypto';

import {
  IsIn,
  IsInt,
  Max,
  Min,
} from 'class-validator';

import { CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/auth.types';

import { StorageService } from '../storage/storage.service';

export const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class PresignDto {
  @ApiProperty({
    enum: Object.keys(ALLOWED_TYPES),
  })
  @IsIn(Object.keys(ALLOWED_TYPES))
  contentType: keyof typeof ALLOWED_TYPES;

  @ApiProperty({
    maximum: MAX_IMAGE_BYTES,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_BYTES)
  sizeBytes: number;
}

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(
    private storage: StorageService,
  ) {}

  @Post('presign')
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
    },
  })
  async presign(
    @CurrentUser() u: AuthUser,
    @Body() dto: PresignDto,
  ) {
    const key =
      `issues/${u.sub}/${randomUUID()}.` +
      `${ALLOWED_TYPES[dto.contentType]}`;

    return {
      key,

      uploadUrl:
        await this.storage.presignPut(
          key,
          dto.contentType,
        ),

      method: 'PUT',

      headers: {
        'Content-Type': dto.contentType,
      },

      expiresInSeconds: 300,
    };
  }
}