import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { getConfig } from '../config';
import { AuditService } from '../audit/audit.service';
import { Database, Queryable } from '../database/database.service';
import { Mailer } from '../mail/mailer.service';
import { StorageService } from '../storage/storage.service';
import { DeleteAccountDto } from './auth.dto';
import { GoogleVerifier } from './google.verifier';

type Purpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 30 * 60_000;

/** Account lifecycle, email verification, and password reset operations. */
@Injectable()
export class AccountService {
  private cfg = getConfig();
  constructor(
    private db: Database,
    private mailer: Mailer,
    private audit: AuditService,
    private storage: StorageService,
    private googleVerifier: GoogleVerifier,
  ) {}

  async exportData(userId: string) {
    return this.db.tx(async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

      const { rows: accounts } = await c.query(
        `SELECT id, email, display_name AS "displayName", role,
                email_verified_at AS "emailVerifiedAt",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM users WHERE id = $1 AND status <> 'DELETED'`,
        [userId],
      );
      const account = accounts[0];
      if (!account) throw new UnauthorizedException();
      const { emailVerifiedAt, ...accountFields } = account;

      const { rows: issues } = await c.query(
        `SELECT i.id, i.category, i.title, i.description, i.status,
                i.possible_duplicate_of AS "possibleDuplicateOf",
                i.confirmation_count AS "confirmationCount",
                ST_Y(i.location::geometry) AS latitude,
                ST_X(i.location::geometry) AS longitude,
                i.created_at AS "createdAt", i.updated_at AS "updatedAt",
                i.resolved_at AS "resolvedAt"
           FROM issues i WHERE i.reporter_id = $1
          ORDER BY i.created_at, i.id`,
        [userId],
      );
      const issueIds = issues.map((issue) => issue.id);
      const { rows: history } = await c.query(
        `SELECT issue_id AS "issueId", from_status AS "fromStatus",
                to_status AS "toStatus", actor_id AS "actorId", note,
                created_at AS "createdAt"
           FROM issue_status_history
          WHERE issue_id = ANY($1::uuid[])
          ORDER BY issue_id, id`,
        [issueIds],
      );
      const { rows: images } = await c.query(
        `SELECT issue_id AS "issueId", storage_key AS "storageKey",
                mime_type AS "mimeType", size_bytes AS "sizeBytes",
                width, height, created_at AS "createdAt"
           FROM issue_images WHERE issue_id = ANY($1::uuid[])
          ORDER BY issue_id, created_at`,
        [issueIds],
      );
      const { rows: confirmations } = await c.query(
        `SELECT issue_id AS "issueId", created_at AS "createdAt"
           FROM issue_confirmations WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      );
      const { rows: followedIssues } = await c.query(
        `SELECT issue_id AS "issueId", created_at AS "createdAt"
           FROM issue_followers WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      );
      const { rows: notifications } = await c.query(
        `SELECT id, issue_id AS "issueId", type, title, body, count,
                dedupe_key AS "dedupeKey", read_at AS "readAt",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM notifications WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      );
      const { rows: linkedAccounts } = await c.query(
        `SELECT provider, provider_user_id AS "providerUserId", email,
                created_at AS "createdAt"
           FROM oauth_identities WHERE user_id = $1 ORDER BY provider`,
        [userId],
      );
      const { rows: uploadedImages } = await c.query(
        `SELECT issue_id AS "issueId", storage_key AS "storageKey",
                mime_type AS "mimeType", size_bytes AS "sizeBytes",
                width, height, created_at AS "createdAt"
           FROM issue_images WHERE uploader_id = $1
          ORDER BY created_at`,
        [userId],
      );
      const { rows: deviceTokens } = await c.query(
        `SELECT token, platform, created_at AS "createdAt",
                last_seen_at AS "lastSeenAt"
           FROM device_tokens WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      );
      const { rows: auditLogs } = await c.query(
        `SELECT action, entity_type AS "entityType", entity_id AS "entityId",
                metadata, created_at AS "createdAt"
           FROM audit_logs
           WHERE actor_id = $1 OR (entity_type = 'user' AND entity_id = $1::text)
          ORDER BY created_at`,
        [userId],
      );

      const historiesByIssue = new Map<string, typeof history>();
      for (const row of history) {
        const rows = historiesByIssue.get(row.issueId) ?? [];
        rows.push(row);
        historiesByIssue.set(row.issueId, rows);
      }
      const imagesByIssue = new Map<string, typeof images>();
      for (const row of images) {
        const rows = imagesByIssue.get(row.issueId) ?? [];
        rows.push(row);
        imagesByIssue.set(row.issueId, rows);
      }
      const withImageUrls = (rows: typeof images) =>
        rows.map((image) => ({ ...image, url: this.storage.publicUrl(image.storageKey) }));

      return {
        exportedAt: new Date().toISOString(),
        account: {
          ...accountFields,
          emailVerified: emailVerifiedAt !== null,
        },
        reportedIssues: issues.map((issue) => ({
          ...issue,
          statusHistory: historiesByIssue.get(issue.id) ?? [],
          images: withImageUrls(imagesByIssue.get(issue.id) ?? []),
        })),
        confirmations,
        followedIssues,
        notifications,
        linkedAccounts,
        uploadedImages: withImageUrls(uploadedImages),
        deviceTokens,
        auditLogs,
      };
    });
  }

  async deleteAccount(userId: string, proof: DeleteAccountDto): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT id, password_hash FROM users WHERE id = $1 AND status <> 'DELETED'`,
      [userId],
    );
    const user = rows[0];
    if (!user) throw new UnauthorizedException();

    let authenticated = false;
    let verifiedGoogleSub: string | undefined;
    if (proof.password && user.password_hash.startsWith('$argon2')) {
      authenticated = await argon2.verify(user.password_hash, proof.password);
    }

    if (!authenticated && proof.googleIdToken) {
      let googleSub: string | undefined;
      try {
        const profile = await this.googleVerifier.verify(proof.googleIdToken);
        if (profile.emailVerified) googleSub = profile.sub;
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        throw new UnauthorizedException('Invalid account deletion credentials');
      }
      if (googleSub) {
        const { rows: identities } = await this.db.query(
          `SELECT 1 FROM oauth_identities
            WHERE user_id = $1 AND provider = 'google' AND provider_user_id = $2`,
          [userId, googleSub],
        );
        authenticated = identities.length > 0;
        if (authenticated) verifiedGoogleSub = googleSub;
      }
    }

    if (!authenticated) {
      throw new UnauthorizedException('A valid current password or linked Google ID token is required');
    }

    await this.db.tx(async (c) => {
      const { rows: lockedUsers } = await c.query(
        `SELECT password_hash FROM users WHERE id = $1 AND status <> 'DELETED' FOR UPDATE`,
        [userId],
      );
      if (!lockedUsers[0] || lockedUsers[0].password_hash !== user.password_hash) {
        throw new UnauthorizedException('Account credentials changed; please try again');
      }
      if (verifiedGoogleSub) {
        const { rows: identities } = await c.query(
          `SELECT 1 FROM oauth_identities
            WHERE user_id = $1 AND provider = 'google'
              AND provider_user_id = $2`,
          [userId, verifiedGoogleSub],
        );
        if (!identities.length) {
          throw new UnauthorizedException('Google identity is no longer linked');
        }
      }

      const { rows: objects } = await c.query(
        `SELECT DISTINCT storage_key
           FROM issue_images
          WHERE uploader_id = $1
             OR issue_id IN (SELECT id FROM issues WHERE reporter_id = $1)`,
        [userId],
      );
      const deletions = await Promise.allSettled(
        objects.map((object) => this.storage.delete(object.storage_key)),
      );
      const failure = deletions.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;

      await c.query(
        `UPDATE issues SET possible_duplicate_of = NULL
          WHERE possible_duplicate_of IN (SELECT id FROM issues WHERE reporter_id = $1)`,
        [userId],
      );
      await c.query(
        `DELETE FROM issue_images
          WHERE uploader_id = $1
             OR issue_id IN (SELECT id FROM issues WHERE reporter_id = $1)`,
        [userId],
      );
      await c.query(`DELETE FROM issues WHERE reporter_id = $1`, [userId]);
      await c.query(`UPDATE issue_status_history SET actor_id = NULL WHERE actor_id = $1`, [userId]);
      await c.query(`UPDATE audit_logs SET actor_id = NULL WHERE actor_id = $1`, [userId]);
      await this.audit.log(
        { action: 'account.deleted', entityType: 'user', entityId: userId },
        c,
      );
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]);
    });
  }

  private async issueToken(q: Queryable, userId: string, purpose: Purpose, ttlMs: number): Promise<string> {
    // Only one live token per purpose: requesting a new one invalidates the previous link.
    await q.query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
    const token = randomBytes(32).toString('base64url');
    await q.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
      [userId, purpose, sha256(token), new Date(Date.now() + ttlMs)],
    );
    return token;
  }

  /** Atomic single-use consume: two concurrent requests can never both succeed. */
  private async consume(q: Queryable, token: string, purpose: Purpose): Promise<string | null> {
    const { rows } = await q.query(
      `UPDATE auth_tokens SET used_at = now()
        WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token), purpose],
    );
    return rows[0]?.user_id ?? null;
  }

  async isTokenValid(token: string, purpose: Purpose): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`,
      [sha256(token), purpose],
    );
    return rows.length > 0;
  }

  async sendVerification(userId: string): Promise<void> {
    const { rows } = await this.db.query(`SELECT email, display_name, email_verified_at FROM users WHERE id = $1`, [userId]);
    const u = rows[0];
    if (!u || u.email_verified_at) return;
    const token = await this.issueToken(this.db.pool, userId, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    const link = `${this.cfg.appBaseUrl}/api/v1/auth/verify-email?token=${token}`;
    await this.mailer.send({
      to: u.email,
      subject: 'Verify your CivicLens email',
      text: `Hi ${u.display_name},\n\nConfirm your email to start reporting issues:\n${link}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email.`,
      html: `<p>Hi ${u.display_name.replace(/</g, '&lt;')},</p><p><a href="${link}">Confirm your email</a> to start reporting issues.</p><p>This link expires in 24 hours.</p>`,
    });
  }

  async verifyEmail(token: string): Promise<boolean> {
    return this.db.tx(async (c) => {
      const userId = await this.consume(c, token, 'VERIFY_EMAIL');
      if (!userId) return false;
      await c.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1`, [userId]);
      await this.audit.log({ actorId: userId, action: 'auth.email_verified', entityType: 'user', entityId: userId }, c);
      return true;
    });
  }

  /** Always resolves silently, whether or not the email exists — the caller returns the same response either way. */
  async forgotPassword(email: string): Promise<void> {
    const { rows } = await this.db.query(`SELECT id, email FROM users WHERE lower(email) = lower($1) AND status = 'ACTIVE'`, [email]);
    const u = rows[0];
    if (!u) return;
    const token = await this.issueToken(this.db.pool, u.id, 'RESET_PASSWORD', RESET_TTL_MS);
    const link = `${this.cfg.appBaseUrl}/api/v1/auth/reset-password?token=${token}`;
    await this.mailer.send({
      to: u.email,
      subject: 'Reset your CivicLens password',
      text: `Someone asked to reset the password for this account.\n\nChoose a new password here (valid for 30 minutes):\n${link}\n\nIf this wasn't you, ignore this email — your password won't change.`,
      html: `<p>Someone asked to reset the password for this account.</p><p><a href="${link}">Choose a new password</a> (valid for 30 minutes).</p><p>If this wasn't you, ignore this email.</p>`,
    });
    await this.audit.log({ actorId: u.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: u.id });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    if (password.length < 10 || password.length > 128) throw new BadRequestException('Password must be 10–128 characters');
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const ok = await this.db.tx(async (c) => {
      const userId = await this.consume(c, token, 'RESET_PASSWORD');
      if (!userId) return false;
      await c.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [userId, hash]);
      // A reset means the old credentials may be compromised: sign the account out everywhere.
      await c.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      await this.audit.log({ actorId: userId, action: 'auth.password_reset_completed', entityType: 'user', entityId: userId }, c);
      return true;
    });
    if (!ok) throw new BadRequestException('This reset link is invalid or has expired');
  }
}