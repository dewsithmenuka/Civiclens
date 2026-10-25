import { Injectable, NotFoundException } from '@nestjs/common';

import { IssueStatus } from '@civiclens/contracts';

import { Database } from '../database/database.service';

import { PushService } from './push.service';

/**
 * After a push for an aggregated notification, stay quiet for this long
 * even if more events arrive.
 */
export const PUSH_COOLDOWN_MS = 15 * 60_000;

const MAX_DEVICES_PER_USER = 10;

const STATUS_TEXT: Record<IssueStatus, string> = {
  [IssueStatus.REPORTED]: 'was reported',
  [IssueStatus.UNDER_REVIEW]: 'is now under review',
  [IssueStatus.ACKNOWLEDGED]: 'was acknowledged by the authorities',
  [IssueStatus.IN_PROGRESS]: 'is being worked on',
  [IssueStatus.RESOLVED]: 'has been resolved',
  [IssueStatus.DUPLICATE]: 'was merged into an existing report',
  [IssueStatus.REJECTED]: 'was closed',
};

export interface IssueRef {
  id: string;
  title: string;
  reporterId: string;
}

interface Draft {
  type: 'STATUS_CHANGED' | 'CONFIRMED';
  title: string;
  body: (count: number) => string;
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private db: Database,
    private push: PushService,
  ) {}

  // ───────── producers ─────────

  /**
   * Notification failures must never fail the user's action.
   */
  async issueStatusChanged(
    issue: IssueRef,
    actorId: string,
    to: IssueStatus,
  ): Promise<void> {
    await this.safely(() =>
      this.fanOut(issue, actorId, {
        type: 'STATUS_CHANGED',
        title: 'Report update',
        body: () => `"${issue.title}" ${STATUS_TEXT[to]}.`,
      }),
    );
  }

  async issueConfirmed(
    issue: IssueRef,
    actorId: string,
  ): Promise<void> {
    await this.safely(() =>
      this.fanOut(issue, actorId, {
        type: 'CONFIRMED',
        title: 'Your report is getting attention',
        dedupeKey: `confirm:${issue.id}`,
        body: (n) =>
          n === 1
            ? `Someone confirmed "${issue.title}".`
            : `${n} people confirmed "${issue.title}".`,
      }),
    );
  }

  private async safely(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'notification_failed',
          error: String(e),
        }),
      );
    }
  }

  /**
   * Recipients = followers + the reporter (an implicit follower),
   * minus whoever caused the event.
   */
  private async fanOut(
    issue: IssueRef,
    actorId: string,
    draft: Draft,
  ): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT user_id
         FROM issue_followers
        WHERE issue_id = $1

        UNION

       SELECT $2::uuid`,
      [issue.id, issue.reporterId],
    );

    for (const { user_id } of rows) {
      if (user_id !== actorId) {
        await this.deliver(user_id, issue.id, draft);
      }
    }
  }

  private async deliver(
    userId: string,
    issueId: string,
    d: Draft,
    attempt = 0,
  ): Promise<void> {
    try {
      const { pushNow, body } = await this.db.tx(async (c) => {
        if (d.dedupeKey) {
          const { rows } = await c.query(
            `SELECT id, count, last_pushed_at
               FROM notifications
              WHERE user_id = $1
                AND dedupe_key = $2
                AND read_at IS NULL
              FOR UPDATE`,
            [userId, d.dedupeKey],
          );

          if (rows[0]) {
            const count = rows[0].count + 1;
            const body = d.body(count);

            const pushNow =
              Date.now() -
                new Date(rows[0].last_pushed_at).getTime() >
              PUSH_COOLDOWN_MS;

            await c.query(
              `UPDATE notifications
                  SET count = $2,
                      body = $3,
                      updated_at = now(),
                      last_pushed_at =
                        CASE
                          WHEN $4 THEN now()
                          ELSE last_pushed_at
                        END
                WHERE id = $1`,
              [rows[0].id, count, body, pushNow],
            );

            return {
              pushNow,
              body,
            };
          }
        }

        const body = d.body(1);

        await c.query(
          `INSERT INTO notifications
             (user_id, issue_id, type, title, body, dedupe_key)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            issueId,
            d.type,
            d.title,
            body,
            d.dedupeKey ?? null,
          ],
        );

        return {
          pushNow: true,
          body,
        };
      });

      if (pushNow) {
        await this.pushTo(userId, {
          title: d.title,
          body,
          data: {
            issueId,
            type: d.type,
          },
        });
      }
    } catch (e: any) {
      // Two events raced to create the same unread aggregate:
      // the unique index rejected one — retry as an update.
      if (e?.code === '23505' && attempt < 2) {
        return this.deliver(
          userId,
          issueId,
          d,
          attempt + 1,
        );
      }

      throw e;
    }
  }

  private async pushTo(
    userId: string,
    payload: {
      title: string;
      body: string;
      data: Record<string, string>;
    },
  ): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT token
         FROM device_tokens
        WHERE user_id = $1`,
      [userId],
    );

    if (!rows.length) {
      return;
    }

    const result = await this.push.send(
      rows.map((r) => r.token),
      payload,
    );

    const { invalidTokens, failures } = result;

    if (invalidTokens.length) {
      await this.db.query(
        `DELETE FROM device_tokens
          WHERE token = ANY($1::text[])`,
        [invalidTokens],
      );
    }

    /**
     * Misconfigured credentials, provider outages, or other
     * delivery failures must be visible in the logs instead
     * of being silently swallowed.
     */
    if (failures?.length) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'push_delivery_failed',
          userId,
          failed: failures.length,
          codes: [
            ...new Set(
              failures.map(
                (failure) => failure.code,
              ),
            ),
          ],
        }),
      );
    }
  }

  // ───────── inbox ─────────

  async list(
    userId: string,
    limit: number,
    offset: number,
  ) {
    const [items, unread] = await Promise.all([
      this.db.query(
        `SELECT id,
                type,
                title,
                body,
                count,
                issue_id AS "issueId",
                (read_at IS NOT NULL) AS read,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
           FROM notifications
          WHERE user_id = $1
          ORDER BY updated_at DESC
          LIMIT $2
         OFFSET $3`,
        [userId, limit, offset],
      ),

      this.db.query(
        `SELECT count(*)::int AS n
           FROM notifications
          WHERE user_id = $1
            AND read_at IS NULL`,
        [userId],
      ),
    ]);

    return {
      items: items.rows,
      unreadCount: unread.rows[0].n,
      limit,
      offset,
    };
  }

  async markRead(
    userId: string,
    id: string,
  ) {
    const { rowCount } = await this.db.query(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, now())
        WHERE id = $1
          AND user_id = $2`,
      [id, userId],
    );

    if (!rowCount) {
      throw new NotFoundException(
        'Notification not found',
      );
    }

    return {
      read: true,
    };
  }

  async markAllRead(userId: string) {
    const { rowCount } = await this.db.query(
      `UPDATE notifications
          SET read_at = now()
        WHERE user_id = $1
          AND read_at IS NULL`,
      [userId],
    );

    return {
      marked: rowCount,
    };
  }

  // ───────── devices ─────────

  async registerDevice(
    userId: string,
    token: string,
    platform: string,
  ) {
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO device_tokens
           (user_id, token, platform)
         VALUES ($1, $2, $3)
         ON CONFLICT (token)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           last_seen_at = now()`,
        [userId, token, platform],
      );

      /**
       * Keep only the most recent devices per user
       * so abandoned tokens don't pile up.
       */
      await c.query(
        `DELETE FROM device_tokens
          WHERE user_id = $1
            AND id NOT IN (
              SELECT id
                FROM device_tokens
               WHERE user_id = $1
               ORDER BY last_seen_at DESC
               LIMIT ${MAX_DEVICES_PER_USER}
            )`,
        [userId],
      );
    });

    return {
      registered: true,
    };
  }

  async unregisterDevice(
    userId: string,
    token: string,
  ) {
    await this.db.query(
      `DELETE FROM device_tokens
        WHERE token = $1
          AND user_id = $2`,
      [token, userId],
    );
  }
}
