import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@civiclens/contracts';
import { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
/** Route needs no token. If a valid token is sent anyway, the user is still attached. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_SUSPENDED = 'allowSuspended';
/** Allows a still-authenticated suspended account to access privacy export or deletion. */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined => ctx.switchToHttp().getRequest().user,
);
