
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Role } from '@civiclens/contracts';

import { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { ChangeStatusDto } from '../issues/dto';

import { AdminService } from './admin.service';
import {
  AdminIssuesQuery,
  AdminUsersQuery,
  AssignIssueDto,
  AuditQuery,
  UpdateIssueDto,
  UpdateUserDto,
} from './dto';

import { FreshStaffGuard } from './fresh-staff.guard';
import { HeatmapQuery } from './heat.dto';

/**
 * Moderator + admin API.
 * Class-level roles allow moderators and admins;
 * methods marked ADMIN override those roles.
 *
 * FreshStaffGuard re-checks the database so suspensions
 * and demotions take effect immediately.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Roles(Role.MODERATOR, Role.ADMIN)
@UseGuards(FreshStaffGuard)
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('issues')
  issues(@Query() q: AdminIssuesQuery) {
    return this.admin.listIssues(q);
  }

  @Get('issues/:id')
  issue(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.issueDetail(id);
  }

  @Get('assignees')
  assignees() {
    return this.admin.listAssignees();
  }

  @Patch('issues/:id/assignee')
  assign(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignIssueDto,
  ) {
    return this.admin.assignIssue(u, id, dto);
  }

  @Patch('issues/:id/status')
  status(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.admin.changeStatus(u, id, dto);
  }

  @Patch('issues/:id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIssueDto,
  ) {
    return this.admin.updateIssue(u, id, dto);
  }

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('heatmap')
  heatmap(@Query() q: HeatmapQuery) {
    return this.admin.heatmap(q);
  }

  @Get('insights')
  insights() {
    return this.admin.insights();
  }

  @Roles(Role.ADMIN)
  @Get('users')
  users(@Query() q: AdminUsersQuery) {
    return this.admin.listUsers(q);
  }

  @Roles(Role.ADMIN)
  @Patch('users/:id')
  updateUser(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.admin.updateUser(u, id, dto);
  }

  @Roles(Role.ADMIN)
  @Get('audit')
  auditLog(@Query() q: AuditQuery) {
    return this.admin.listAudit(q);
  }
}
