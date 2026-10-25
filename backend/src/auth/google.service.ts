import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { Role } from '@civiclens/contracts';

import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';

import { AuthService, AuthTokens } from './auth.service';
import { GoogleProfile, GoogleVerifier } from './google.verifier';

/**
 * Not a valid Argon2 hash, so password login can never succeed for accounts
 * that have no password. Login catches the verify error and answers 401.
 *
 * OAuth-only users can still set a password through "forgot password".
 */
const NO_PASSWORD = '!no-password-oauth-only';

@Injectable()
export class GoogleAuthService {
  constructor(
    private db: Database,
    private verifier: GoogleVerifier,
    private auth: AuthService,
    private audit: AuditService,
  ) {}

  async signIn(idToken: string): Promise<AuthTokens> {
    let profile: GoogleProfile;

    try {
      profile = await this.verifier.verify(idToken);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) {
        throw e;
      }

      throw new UnauthorizedException('Invalid Google token');
    }

    // An unverified Google email proves nothing about who owns that address.
    if (!profile.emailVerified) {
      throw new UnauthorizedException(
        'Google account email is not verified',
      );
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const user = await this.resolveUser(profile);

        return await this.auth.startSession(
          user.id,
          user.role,
        );
      } catch (e: any) {
        // Two first-time sign-ins raced to create the same user/identity.
        // The unique index stopped one; retry as a lookup.
        if (e?.code === '23505' && attempt === 0) {
          continue;
        }

        throw e;
      }
    }
  }

  private resolveUser(
    p: GoogleProfile,
  ): Promise<{ id: string; role: Role }> {
    return this.db.tx(async (c) => {
      const active = (u: {
        id: string;
        role: Role;
        status: string;
      }) => {
        if (u.status !== 'ACTIVE') {
          throw new UnauthorizedException(
            'Account is not active',
          );
        }

        return {
          id: u.id,
          role: u.role,
        };
      };

      // 1) Returning Google user.
      // Identify by the stable Google "sub", never by email.
      const known = await c.query(
        `
          SELECT
            u.id,
            u.role,
            u.status
          FROM oauth_identities o
          JOIN users u ON u.id = o.user_id
          WHERE o.provider = 'google'
            AND o.provider_user_id = $1
        `,
        [p.sub],
      );

      if (known.rows[0]) {
        return active(known.rows[0]);
      }

      // 2) A local account already uses this email -> link it.
      const local = await c.query(
        `
          SELECT
            id,
            role,
            status,
            email_verified_at
          FROM users
          WHERE lower(email) = lower($1)
          FOR UPDATE
        `,
        [p.email],
      );

      if (local.rows[0]) {
        const u = local.rows[0];

        const result = active(u);

        if (!u.email_verified_at) {
          /*
           * Pre-hijacking defence:
           *
           * Whoever registered this address by password never proved they
           * owned it, but the real owner just did through Google.
           *
           * Remove the unproven password credentials, revoke sessions, and
           * invalidate outstanding email verification/reset tokens.
           */
          await c.query(
            `
              UPDATE users
              SET
                password_hash = $2,
                email_verified_at = now(),
                updated_at = now()
              WHERE id = $1
            `,
            [u.id, NO_PASSWORD],
          );

          await c.query(
            `
              UPDATE refresh_tokens
              SET revoked_at = now()
              WHERE user_id = $1
                AND revoked_at IS NULL
            `,
            [u.id],
          );

          await c.query(
            `
              UPDATE auth_tokens
              SET used_at = now()
              WHERE user_id = $1
                AND used_at IS NULL
            `,
            [u.id],
          );

          await this.audit.log(
            {
              actorId: u.id,
              action: 'auth.unverified_account_claimed_via_google',
              entityType: 'user',
              entityId: u.id,
            },
            c,
          );
        }

        await c.query(
          `
            INSERT INTO oauth_identities (
              user_id,
              provider,
              provider_user_id,
              email
            )
            VALUES ($1, 'google', $2, $3)
          `,
          [u.id, p.sub, p.email],
        );

        await this.audit.log(
          {
            actorId: u.id,
            action: 'auth.google_linked',
            entityType: 'user',
            entityId: u.id,
          },
          c,
        );

        return result;
      }

      // 3) Brand-new user.
      // Google verified the email, so the account starts verified.
      const name = (
        p.name?.trim() ||
        p.email.split('@')[0]
      )
        .slice(0, 60)
        .padEnd(2, '_');

      const created = await c.query(
        `
          INSERT INTO users (
            email,
            password_hash,
            display_name,
            email_verified_at
          )
          VALUES ($1, $2, $3, now())
          RETURNING id, role
        `,
        [p.email, NO_PASSWORD, name],
      );

      const u = created.rows[0];

      await c.query(
        `
          INSERT INTO oauth_identities (
            user_id,
            provider,
            provider_user_id,
            email
          )
          VALUES ($1, 'google', $2, $3)
        `,
        [u.id, p.sub, p.email],
      );

      await this.audit.log(
        {
          actorId: u.id,
          action: 'auth.google_register',
          entityType: 'user',
          entityId: u.id,
        },
        c,
      );

      return {
        id: u.id as string,
        role: u.role as Role,
      };
    });
  }
}
