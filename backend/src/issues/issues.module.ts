import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { IssuesController } from './issues.controller';
import { IssuesRepository } from './issues.repository';
import { IssuesService } from './issues.service';

@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [IssuesController],
  providers: [IssuesRepository, IssuesService],
  exports: [IssuesService, IssuesRepository], // the admin module reuses both
})
export class IssuesModule {}