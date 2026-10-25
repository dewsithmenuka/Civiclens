import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(128) password: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) displayName: string;
}
export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(128) password: string;
}
export class RefreshDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200) refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
}
export class ResetPasswordDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(100) token: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MaxLength(128) password: string;
}

export class GoogleSignInDto {
  @ApiProperty({ description: 'Google ID token obtained on the device via Google Sign-In' })
  @IsString() @MinLength(20) @MaxLength(4096) idToken: string;
}

export class DeleteAccountDto {
  @ApiPropertyOptional({ description: 'Current password for a password-based account' })
  @IsOptional() @IsString() @MaxLength(128) password?: string;

  @ApiPropertyOptional({ description: 'Fresh Google ID token for a linked Google account' })
  @IsOptional() @IsString() @MinLength(20) @MaxLength(4096) googleIdToken?: string;
}