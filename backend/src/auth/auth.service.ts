import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import * as argon2 from 'argon2';

import {
  createHash,
  randomUUID,
} from 'crypto';

import { getConfig } from '../config';

import { AuditService } from '../audit/audit.service';

import {
  Database,
  Queryable,
} from '../database/database.service';

import { AccountService } from './account.service';

import { Role } from '@civiclens/contracts';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private cfg = getConfig();

  constructor(
    private db: Database,
    private jwt: JwtService,
    private audit: AuditService,
    private account: AccountService,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthTokens> {
    const hash = await argon2.hash(
      password,
      {
        type: argon2.argon2id,
      },
    );

    try {
      const result = await this.db.tx(
        async (c) => {
          const { rows } =
            await c.query(
              `INSERT INTO users
                 (email, password_hash, display_name)
               VALUES ($1, $2, $3)
               RETURNING id, role`,
              [
                email.trim(),
                hash,
                displayName.trim(),
              ],
            );

          await this.audit.log(
            {
              actorId: rows[0].id,
              action: 'auth.register',
              entityType: 'user',
              entityId: rows[0].id,
            },
            c,
          );

          // Create a new refresh-token family
          // for this login session.
          const familyId =
            randomUUID();

          const tokens =
            await this.issueTokens(
              c,
              rows[0].id,
              rows[0].role,
              familyId,
            );

          return {
            userId: rows[0].id,
            tokens,
          };
        },
      );

      // The transaction has committed
      // successfully.
      //
      // Send the verification email after
      // the user exists.
      await this.account.sendVerification(
        result.userId,
      );

      return result.tokens;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          'Email already registered',
        );
      }

      throw e;
    }
  }

  async login(
    email: string,
    password: string,
  ): Promise<AuthTokens> {
    const { rows } =
      await this.db.query(
        `SELECT
           id,
           password_hash,
           role,
           status
         FROM users
         WHERE lower(email) = lower($1)`,
        [email.trim()],
      );

    const user = rows[0];

    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !user.password_hash
    ) {
      throw new UnauthorizedException(
        'Invalid email or password',
      );
    }

    /*
     * OAuth-only accounts use a sentinel value
     * instead of an Argon2 password hash.
     *
     * Never pass that value to argon2.verify(),
     * because it is intentionally not a valid PHC
     * hash and Argon2 would throw a 500 error.
     */
    if (
      !user.password_hash.startsWith('$argon2')
    ) {
      throw new UnauthorizedException(
        'Invalid email or password',
      );
    }

    const valid =
      await argon2.verify(
        user.password_hash,
        password,
      );

    if (!valid) {
      throw new UnauthorizedException(
        'Invalid email or password',
      );
    }

    return this.db.tx(async (c) => {
      // Create a new refresh-token family
      // for this login session.
      const familyId =
        randomUUID();

      return this.issueTokens(
        c,
        user.id,
        user.role,
        familyId,
      );
    });
  }

  async refresh(
    refreshToken: string,
  ): Promise<AuthTokens> {
    const outcome = await this.db.tx(
      async (c) => {
        const { rows } = await c.query(
          `SELECT
             rt.id,
             rt.user_id AS "userId",
             rt.family_id AS "familyId",
             rt.expires_at AS "expiresAt",
             rt.revoked_at AS "revokedAt",
             u.role,
             u.status
           FROM refresh_tokens rt
           JOIN users u
             ON u.id = rt.user_id
           WHERE rt.token_hash =
             encode(
               digest($1, 'sha256'),
               'hex'
             )
           FOR UPDATE OF rt`,
          [refreshToken],
        );
        const row = rows[0];

        if (
          !row ||
          row.status !== 'ACTIVE'
        ) {
          return { invalid: true as const };
        }

        if (row.revokedAt) {
          await c.query(
            `UPDATE refresh_tokens
             SET revoked_at =
               COALESCE(revoked_at, now())
             WHERE family_id = $1
               AND revoked_at IS NULL`,
            [row.familyId],
          );
          await this.audit.log(
            {
              actorId: row.userId,
              action: 'auth.refresh_token_reuse',
              entityType: 'refresh_token',
              entityId: row.id,
            },
            c,
          );
          return { reuse: true as const };
        }

        if (
          new Date(
            row.expiresAt,
          ).getTime() <= Date.now()
        ) {
          return { invalid: true as const };
        }

        const rotated = await c.query(
          `UPDATE refresh_tokens
           SET revoked_at = now()
           WHERE id = $1
             AND revoked_at IS NULL
           RETURNING id`,
          [row.id],
        );

        if (rotated.rowCount !== 1) {
          await c.query(
            `UPDATE refresh_tokens
             SET revoked_at =
               COALESCE(revoked_at, now())
             WHERE family_id = $1
               AND revoked_at IS NULL`,
            [row.familyId],
          );
          await this.audit.log(
            {
              actorId: row.userId,
              action: 'auth.refresh_token_reuse',
              entityType: 'refresh_token',
              entityId: row.id,
            },
            c,
          );
          return { reuse: true as const };
        }

        return {
          tokens: await this.issueTokens(
            c,
            row.userId,
            row.role,
            row.familyId,
          ),
        };
      },
    );

    if ('reuse' in outcome) {
      throw new UnauthorizedException(
        'Refresh token reuse detected',
      );
    }

    if ('invalid' in outcome) {
      throw new UnauthorizedException(
        'Invalid refresh token',
      );
    }

    return outcome.tokens;
  }

  /**
   * Start a fresh session for a user who
   * has already been authenticated by
   * another mechanism such as OAuth.
   */
  startSession(
    userId: string,
    role: Role,
  ): Promise<AuthTokens> {
    return this.db.tx((c) =>
      this.issueTokens(
        c,
        userId,
        role,
        randomUUID(),
      ),
    );
  }

  async logout(
    refreshToken: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens
       SET revoked_at = now()
       WHERE token_hash =
         encode(
           digest($1, 'sha256'),
           'hex'
         )
         AND revoked_at IS NULL`,
      [refreshToken],
    );
  }

  async me(userId: string) {
    const { rows } =
      await this.db.query(
        `SELECT
           id,
           email,
           display_name AS "displayName",
           role,
           (email_verified_at IS NOT NULL)
             AS "emailVerified",
           created_at AS "createdAt"
         FROM users
         WHERE id = $1`,
        [userId],
      );

    if (!rows[0]) {
      throw new UnauthorizedException();
    }

    return rows[0];
  }

  private async issueTokens(
    q: Queryable,
    userId: string,
    role: string,
    familyId: string,
  ): Promise<AuthTokens> {
    const accessToken =
      await this.jwt.signAsync({
        sub: userId,
        role,
      });

    const refreshToken =
      randomUUID();

    const refreshHash =
      createHash('sha256')
        .update(refreshToken)
        .digest('hex');

    const expiresAt = new Date(
      Date.now() +
        this.cfg.refreshTokenTtlDays *
          24 *
          60 *
          60 *
          1000,
    );

    await q.query(
      `INSERT INTO refresh_tokens
         (
           id,
           user_id,
           family_id,
           token_hash,
           expires_at
         )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        userId,
        familyId,
        refreshHash,
        expiresAt,
      ],
    );

    return {
      accessToken,
      refreshToken,
    };
  }
}
