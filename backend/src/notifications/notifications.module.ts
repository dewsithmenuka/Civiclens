import { Module } from '@nestjs/common';
import { DevicesController, NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService, createPushService } from './push.service';

@Module({
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService, { provide: PushService, useFactory: createPushService }],
  exports: [NotificationsService],
})
export class NotificationsModule {}