import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALLOW_SUSPENDED, IS_PUBLIC, ROLES_KEY } from './decorators';
import { Role } from '@civiclens/contracts';
import { Database } from '../database/database.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private db: Database) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const allowSuspended = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED, [ctx.getHandler(), ctx.getClass()]);
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException();
    }
    try {
      req.user = await this.jwt.verifyAsync(token);
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException();
    }
    const { rows } = await this.db.query<{ status: string; role: Role }>(
      `SELECT status, role FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const user = rows[0];
    if (!user || user.status === 'DELETED') {
      if (isPublic) {
        req.user = undefined;
        return true;
      }
      throw new UnauthorizedException();
    }
    if (user.status !== 'ACTIVE' && !allowSuspended) {
      if (isPublic) {
        req.user = undefined;
        return true;
      }
      throw new ForbiddenException('Account is not active');
    }
    req.user.role = user.role;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
