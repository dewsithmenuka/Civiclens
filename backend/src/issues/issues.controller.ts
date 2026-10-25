import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';

import { Role } from '@civiclens/contracts';

import { CurrentUser, Public, Roles } from '../common/decorators';

import { AuthUser } from '../common/auth.types';

import { FreshStaffGuard } from '../admin/fresh-staff.guard';

import {
  AddImageDto,
  ChangeStatusDto,
  CreateIssueDto,
  ListQuery,
  MapQuery,
  NearbyQuery,
} from './dto';

import { IssuesService } from './issues.service';

@ApiTags('issues')
@ApiBearerAuth()
@Controller('issues')
export class IssuesController {
  constructor(private issues: IssuesService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateIssueDto,
  ) {
    return this.issues.create(u, dto);
  }

  @Public()
  @Get()
  list(@Query() q: ListQuery) {
    return this.issues.list(q);
  }

  // Static routes MUST be declared before ':id'.
  @Public()
  @Get('nearby')
  nearby(@Query() q: NearbyQuery) {
    return this.issues.nearby(q);
  }

  @Public()
  @Get('map')
  map(@Query() q: MapQuery) {
    return this.issues.map(q);
  }

  @Public()
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u?: AuthUser,
  ) {
    return this.issues.get(id, u);
  }

  @Get(':id/follow')
  following(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.issues.isFollowing(u, id);
  }

  @Roles(Role.MODERATOR, Role.ADMIN)
  @UseGuards(FreshStaffGuard)
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.issues.changeStatus(u, id, dto);
  }

  @Post(':id/images')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  addImage(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddImageDto,
  ) {
    return this.issues.addImage(u, id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.issues.confirm(u, id);
  }

  @Post(':id/follow')
  @HttpCode(200)
  follow(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.issues.follow(u, id, true);
  }

  @Delete(':id/follow')
  unfollow(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.issues.follow(u, id, false);
  }
}
