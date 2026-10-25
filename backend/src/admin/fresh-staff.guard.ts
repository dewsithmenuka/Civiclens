import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@civiclens/contracts';
import { ROLES_KEY } from '../common/decorators';
import { Database } from '../database/database.service';

/**
 * The JWT's role claim can be up to 15 minutes old. For admin routes that is too long: if someone is
 * suspended or demoted, they must lose access on their very next request. So we re-read role + status
 * from the database here (one indexed primary-key lookup).
 */
@Injectable()
export class FreshStaffGuard implements CanActivate {
  constructor(private db: Database, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const allowed =
      this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [Role.MODERATOR, Role.ADMIN];
    const { rows } = await this.db.query(`SELECT role, status FROM users WHERE id = $1`, [req.user?.sub]);
    const user = rows[0];
    if (!user || user.status !== 'ACTIVE' || !allowed.includes(user.role)) throw new ForbiddenException('Insufficient role');
    req.user.role = user.role; // downstream code sees the truth, not the stale token claim
    return true;
  }
}