import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/auth.types';
import { NotificationsService } from './notifications.service';

export class ListNotificationsQuery {
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = 20;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset: number = 0;
}
export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token' }) @IsString() @MinLength(10) @MaxLength(4096) token: string;
  @ApiProperty({ enum: ['ios', 'android', 'web'] }) @IsIn(['ios', 'android', 'web']) platform: string;
}
export class UnregisterDeviceDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(4096) token: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListNotificationsQuery) { return this.svc.list(u.sub, q.limit, q.offset); }

  // Static route before ':id/read'.
  @Post('read-all') @HttpCode(200)
  readAll(@CurrentUser() u: AuthUser) { return this.svc.markAllRead(u.sub); }

  @Post(':id/read') @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.markRead(u.sub, id); }
}

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private svc: NotificationsService) {}

  @Post() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @HttpCode(200)
  register(@CurrentUser() u: AuthUser, @Body() dto: RegisterDeviceDto) { return this.svc.registerDevice(u.sub, dto.token, dto.platform); }

  @Post('unregister') @HttpCode(204)
  async unregister(@CurrentUser() u: AuthUser, @Body() dto: UnregisterDeviceDto) { await this.svc.unregisterDevice(u.sub, dto.token); }
}