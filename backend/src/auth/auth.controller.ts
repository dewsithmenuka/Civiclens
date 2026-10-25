import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import type {
  Request,
  Response,
} from 'express';

import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';

import {
  AllowSuspended,
  CurrentUser,
  Public,
} from '../common/decorators';

import { AuthUser } from '../common/auth.types';

import { AuthService } from './auth.service';

import { AccountService } from './account.service';

import { GoogleAuthService } from './google.service';

import {
  ForgotPasswordDto,
  DeleteAccountDto,
  GoogleSignInDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto';

import {
  messagePage,
  resetFormPage,
} from './pages';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private account: AccountService,
    private google: GoogleAuthService,
  ) {}

  @Public()
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
    },
  })
  @Post('register')
  register(
    @Body() dto: RegisterDto,
  ) {
    return this.auth.register(
      dto.email,
      dto.password,
      dto.displayName,
    );
  }

  @Public()
  @Throttle({
    default: {
      limit: 10,
      ttl: 60_000,
    },
  })
  @HttpCode(200)
  @Post('login')
  login(
    @Body() dto: LoginDto,
  ) {
    return this.auth.login(
      dto.email,
      dto.password,
    );
  }

  @Public()
  @Throttle({
    default: {
      limit: 10,
      ttl: 60_000,
    },
  })
  @HttpCode(200)
  @Post('google')
  googleSignIn(
    @Body() dto: GoogleSignInDto,
  ) {
    return this.google.signIn(
      dto.idToken,
    );
  }

  @Public()
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
    },
  })
  @HttpCode(200)
  @Post('refresh')
  refresh(
    @Body() dto: RefreshDto,
  ) {
    return this.auth.refresh(
      dto.refreshToken,
    );
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Body() dto: RefreshDto,
  ) {
    await this.auth.logout(
      dto.refreshToken,
    );
  }

  @ApiBearerAuth()
  @Get('me')
  me(
    @CurrentUser() user: AuthUser,
  ) {
    return this.auth.me(
      user.sub,
    );
  }

  @ApiBearerAuth()
  @AllowSuspended()
  @Header('Content-Disposition', 'attachment; filename="civiclens-data-export.json"')
  @Header('Cache-Control', 'no-store')
  @Get('me/export')
  exportAccountData(
    @CurrentUser() user: AuthUser,
  ) {
    return this.account.exportData(user.sub);
  }

  @ApiBearerAuth()
  @AllowSuspended()
  @HttpCode(204)
  @Delete('me')
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
  ) {
    await this.account.deleteAccount(user.sub, dto);
  }

  // ───────── email verification ─────────

  @ApiBearerAuth()
  @Throttle({
    default: {
      limit: 3,
      ttl: 3_600_000,
    },
  })
  @HttpCode(202)
  @Post('verify-email/resend')
  async resendVerification(
    @CurrentUser() user: AuthUser,
  ) {
    await this.account.sendVerification(
      user.sub,
    );

    return {
      message:
        'If your email is not yet verified, a new link is on its way.',
    };
  }

  @Public()
  @Get('verify-email')
  async verifyEmail(
    @Query('token') token: string,
    @Res({
      passthrough: true,
    })
    res: Response,
  ) {
    const ok =
      typeof token === 'string' &&
      token.length <= 100 &&
      (await this.account.verifyEmail(
        token,
      ));

    res
      .type('html')
      .status(ok ? 200 : 400);

    return ok
      ? messagePage(
          'Email verified',
          'Thanks! You can go back to the CivicLens app and start reporting.',
        )
      : messagePage(
          'Link invalid or expired',
          'Open the app and request a new verification email.',
        );
  }

  // ───────── password reset ─────────

  @Public()
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
    },
  })
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ) {
    await this.account.forgotPassword(
      dto.email,
    );

    // Identical response whether or not
    // the account exists (no user enumeration).
    return {
      message:
        'If an account exists for that email, a reset link is on its way.',
    };
  }

  @Public()
  @Get('reset-password')
  async resetPasswordForm(
    @Query('token') token: string,
    @Res({
      passthrough: true,
    })
    res: Response,
  ) {
    const ok =
      typeof token === 'string' &&
      token.length <= 100 &&
      (await this.account.isTokenValid(
        token,
        'RESET_PASSWORD',
      ));

    res
      .type('html')
      .status(ok ? 200 : 400);

    return ok
      ? resetFormPage(token)
      : messagePage(
          'Link invalid or expired',
          'Request a new password reset from the app.',
        );
  }

  @Public()
  @Throttle({
    default: {
      limit: 10,
      ttl: 60_000,
    },
  })
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({
      passthrough: true,
    })
    res: Response,
  ) {
    await this.account.resetPassword(
      dto.token,
      dto.password,
    );

    if (
      req.is(
        'application/x-www-form-urlencoded',
      )
    ) {
      res.type('html');

      return messagePage(
        'Password updated',
        'You can now sign in to CivicLens with your new password.',
      );
    }

    return {
      message: 'Password updated',
    };
  }
}
