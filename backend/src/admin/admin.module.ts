import { Module } from '@nestjs/common';

import { IssuesModule } from '../issues/issues.module';
import { RealtimeModule } from '../realtime/realtime.module';

import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import { FreshStaffGuard } from './fresh-staff.guard';
import { HeatRepository } from './heat.repository';

@Module({
  imports: [
    IssuesModule,
    RealtimeModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminRepository,
    HeatRepository,
    FreshStaffGuard,
  ],
  exports: [FreshStaffGuard],
})
export class AdminModule {}
