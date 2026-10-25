import { Injectable } from '@nestjs/common';

import { Database } from '../database/database.service';

/** `%` and `_` typed by a user must match literally, not act as wildcards. */
export const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

const SORTS = {
  newest: 'i.created_at DESC',
  oldest: 'i.created_at ASC',
  confirmed: 'i.confirmation_count DESC, i.created_at DESC',
} as const;

@Injectable()
export class AdminRepository {
  constructor(private db: Database) {}

  async issues(f: {
    status?: string;
    category?: string;
    flagged?: boolean;
    search?: string;
    reportId?: string;
    createdFrom?: string;
    createdTo?: string;
    latitude?: number;
    longitude?: number;
    radiusM?: number;
    sort: keyof typeof SORTS;
    limit: number;
    offset: number;
  }) {
    const where = `
      WHERE ($1::text IS NULL OR i.status = $1)
        AND ($2::text IS NULL OR i.category = $2)
        AND (NOT $3::boolean OR (i.possible_duplicate_of IS NOT NULL AND i.status IN ('REPORTED','UNDER_REVIEW')))
        AND ($4::text IS NULL OR i.title ILIKE $4)
        AND ($5::uuid IS NULL OR i.id = $5)
        AND ($6::timestamptz IS NULL OR i.created_at >= $6)
        AND ($7::date IS NULL OR i.created_at < ($7::date + interval '1 day'))
        AND ($8::float8 IS NULL OR ST_DWithin(
          i.location,
          ST_SetSRID(ST_MakePoint($9::float8, $8::float8), 4326)::geography,
          $10::float8
        ))`;

    const params = [
      f.status ?? null,
      f.category ?? null,
      !!f.flagged,
      f.search ? likePattern(f.search) : null,
      f.reportId ?? null,
      f.createdFrom ?? null,
      f.createdTo ?? null,
      f.latitude ?? null,
      f.longitude ?? null,
      f.radiusM ?? null,
    ];

    const [rows, total] = await Promise.all([
      this.db.query(
        `SELECT i.id, i.category, i.title, i.description, i.status, i.confirmation_count, i.possible_duplicate_of,
                i.created_at, i.updated_at,
                assigned.id AS assignee_id, assigned.display_name AS assignee_name, assigned.role AS assignee_role,
                ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
                u.id AS reporter_id, u.display_name AS reporter_name,
                (SELECT count(*)::int FROM issue_images im WHERE im.issue_id = i.id) AS image_count
           FROM issues i JOIN users u ON u.id = i.reporter_id
           LEFT JOIN users assigned ON assigned.id = i.assigned_moderator_id
           ${where} ORDER BY ${SORTS[f.sort]} LIMIT $11 OFFSET $12`,
        [...params, f.limit, f.offset],
      ),
      this.db.query(
        `SELECT count(*)::int AS n FROM issues i ${where}`,
        params,
      ),
    ]);

    return { rows: rows.rows, total: total.rows[0].n };
  }

  async issueDetail(id: string) {
    const issue = await this.db.query(
      `SELECT i.id, i.title, i.description, i.status, i.category,
              i.created_at, i.updated_at, i.resolved_at, i.confirmation_count,
              assigned.id AS assignee_id, assigned.display_name AS assignee_name, assigned.role AS assignee_role,
              reporter.display_name AS reporter_name, reporter.id AS reporter_id,
              ST_Y(i.location::geometry) AS lat,
              ST_X(i.location::geometry) AS lng,
              (
                SELECT COUNT(*)::int
                FROM issue_followers f
                WHERE f.issue_id = i.id
              ) AS follower_count
        FROM issues i
        JOIN users reporter ON reporter.id = i.reporter_id
        LEFT JOIN users assigned ON assigned.id = i.assigned_moderator_id
        WHERE i.id = $1`,
      [id],
    );

    if (!issue.rows[0]) return null;

    const [images, timeline, candidate, audit, duplicates] = await Promise.all([
      this.db.query(
        `SELECT id, storage_key, width, height
           FROM issue_images
          WHERE issue_id = $1
          ORDER BY created_at`,
        [id],
      ),

      this.db.query(
        `SELECT h.from_status, h.to_status, h.note, h.created_at,
                u.display_name AS actor_name, u.role AS actor_role
           FROM issue_status_history h
           LEFT JOIN users u ON u.id = h.actor_id
          WHERE h.issue_id = $1
          ORDER BY h.id`,
        [id],
      ),

      this.db.query(
        `SELECT d.id, d.title, d.status, d.category, d.created_at, d.confirmation_count,
                ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng,
                ST_Distance(d.location, i.location) AS distance_m
           FROM issues i
           JOIN issues d ON d.id = i.possible_duplicate_of
          WHERE i.id = $1`,
        [id],
      ),

      this.db.query(
        `SELECT a.id, a.action, a.metadata, a.created_at,
                u.display_name AS actor_name, u.role AS actor_role
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.entity_type = 'issue' AND a.entity_id = $1
          ORDER BY a.id DESC LIMIT 100`,
        [id],
      ),

      this.db.query(
        `SELECT id, title, status, created_at
           FROM issues
          WHERE possible_duplicate_of = $1
          ORDER BY created_at`,
        [id],
      ),
    ]);

    return {
      issue: issue.rows[0],
      images: images.rows,
      timeline: timeline.rows,
      candidate: candidate.rows[0] ?? null,
      duplicates: duplicates.rows,
      audit: audit.rows,
    };
  }

  async assignees() {
    const { rows } = await this.db.query(
      `SELECT id, display_name, role
         FROM users
        WHERE role IN ('MODERATOR', 'ADMIN') AND status = 'ACTIVE'
        ORDER BY role, lower(display_name), id`,
    );
    return rows;
  }

  async stats() {
    const [byStatus, byCategory, queue, series, resolution] =
      await Promise.all([
        this.db.query(
          `SELECT status, count(*)::int AS n FROM issues GROUP BY status`,
        ),

        this.db.query(
          `SELECT category, count(*)::int AS n FROM issues GROUP BY category ORDER BY n DESC`,
        ),

        this.db.query(
          `SELECT count(*) FILTER (WHERE status IN ('REPORTED','UNDER_REVIEW'))::int AS open_queue,
                  count(*) FILTER (WHERE status IN ('REPORTED','UNDER_REVIEW') AND possible_duplicate_of IS NOT NULL)::int AS flagged_duplicates,
                  COALESCE(round(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'REPORTED'))) / 3600)::int, 0) AS oldest_unreviewed_hours
             FROM issues`,
        ),

        this.db.query(
          `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0) AS created, COALESCE(r.n, 0) AS resolved
             FROM generate_series(current_date - 13, current_date, interval '1 day') d
             LEFT JOIN (SELECT created_at::date AS day, count(*)::int AS n FROM issues WHERE created_at >= current_date - 13 GROUP BY 1) c ON c.day = d::date
             LEFT JOIN (SELECT resolved_at::date AS day, count(*)::int AS n FROM issues WHERE resolved_at >= current_date - 13 GROUP BY 1) r ON r.day = d::date
             ORDER BY d`,
        ),

        this.db.query(
          `SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_at - created_at)) / 3600))::numeric, 1)::float AS median_hours,
                  count(*)::int AS sample
             FROM issues WHERE resolved_at IS NOT NULL AND resolved_at >= now() - interval '90 days'`,
        ),
      ]);

    return {
      byStatus: byStatus.rows,
      byCategory: byCategory.rows,
      queue: queue.rows[0],
      series: series.rows,
      resolution: resolution.rows[0],
    };
  }

  async users(f: {
    search?: string;
    role?: string;
    status?: string;
    limit: number;
    offset: number;
  }) {
    const where = `
      WHERE ($1::text IS NULL OR u.role = $1) AND ($2::text IS NULL OR u.status = $2)
        AND ($3::text IS NULL OR u.email ILIKE $3 OR u.display_name ILIKE $3)`;

    const params = [
      f.role ?? null,
      f.status ?? null,
      f.search ? likePattern(f.search) : null,
    ];

    const [rows, total] = await Promise.all([
      this.db.query(
        `SELECT u.id, u.email, u.display_name, u.role, u.status, (u.email_verified_at IS NOT NULL) AS verified, u.created_at,
                (SELECT count(*)::int FROM issues i WHERE i.reporter_id = u.id) AS issue_count
           FROM users u ${where} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
        [...params, f.limit, f.offset],
      ),

      this.db.query(
        `SELECT count(*)::int AS n FROM users u ${where}`,
        params,
      ),
    ]);

    return { rows: rows.rows, total: total.rows[0].n };
  }

  async audit(f: {
    entityType?: string;
    action?: string;
    entityId?: string;
    limit: number;
    offset: number;
  }) {
    const where = `WHERE ($1::text IS NULL OR a.entity_type = $1) AND ($2::text IS NULL OR a.action = $2)
                    AND ($3::text IS NULL OR a.entity_id = $3)`;

    const params = [f.entityType ?? null, f.action ?? null, f.entityId ?? null];

    const [rows, total] = await Promise.all([
      this.db.query(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at, u.display_name AS actor_name, u.role AS actor_role
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where} ORDER BY a.id DESC LIMIT $4 OFFSET $5`,
        [...params, f.limit, f.offset],
      ),

      this.db.query(
        `SELECT count(*)::int AS n FROM audit_logs a ${where}`,
        params,
      ),
    ]);

    return { rows: rows.rows, total: total.rows[0].n };
  }
}
