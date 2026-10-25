import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { getConfig } from '../config';
import { MailModule } from '../mail/mailer.service';

import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  createGoogleVerifier,
  GoogleVerifier,
} from './google.verifier';
import { GoogleAuthService } from './google.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: getConfig().jwtSecret,
      signOptions: {
        expiresIn: getConfig().accessTokenTtl as any,
      },
    }),
    MailModule,
  ],

  controllers: [
    AuthController,
  ],

  providers: [
    AuthService,
    AccountService,
    GoogleAuthService,

    {
      provide: GoogleVerifier,
      useFactory: () => createGoogleVerifier(),
    },
  ],
})
export class AuthModule {}
