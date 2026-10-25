import { Global, Module } from '@nestjs/common';

import {
  S3StorageService,
  StorageService,
} from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useClass: S3StorageService,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}