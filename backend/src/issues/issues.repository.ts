import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../database/database.service';
import { IssueStatus } from '@civiclens/contracts';

/** ~0.0005° ≈ 55 m: public coordinates are snapped to this grid (privacy by design). */
export const PUBLIC_GRID_DEG = 0.0005;

const SELECT = `
  SELECT i.id, i.category, i.title, i.description, i.status, i.confirmation_count,
         i.possible_duplicate_of, i.created_at, i.updated_at, i.reporter_id,
         ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
         ST_Y(ST_SnapToGrid(i.location::geometry, ${PUBLIC_GRID_DEG})) AS public_lat,
         ST_X(ST_SnapToGrid(i.location::geometry, ${PUBLIC_GRID_DEG})) AS public_lng`;

export interface IssueRow {
  id: string; category: string; title: string; description: string | null; status: IssueStatus;
  confirmation_count: number; possible_duplicate_of: string | null; created_at: Date; updated_at: Date;
  reporter_id: string; lat: number; lng: number; public_lat: number; public_lng: number; distance_m?: number;
}

@Injectable()
export class IssuesRepository {
  constructor(private db: Database) {}

  async insert(
    q: Queryable,
    p: { reporterId: string; category: string; title: string; description?: string; lat: number; lng: number; clientRequestId?: string; possibleDuplicateOf?: string | null },
  ): Promise<string | null> {
    const { rows } = await q.query(
      `INSERT INTO issues (reporter_id, category, title, description, location, client_request_id, possible_duplicate_of)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($6,$5),4326)::geography, $7, $8)
       ON CONFLICT (reporter_id, client_request_id) DO NOTHING
       RETURNING id`,
      [p.reporterId, p.category, p.title, p.description ?? null, p.lat, p.lng, p.clientRequestId ?? null, p.possibleDuplicateOf ?? null],
    );
    return rows[0]?.id ?? null;
  }

  async findByClientRequest(q: Queryable, reporterId: string, clientRequestId: string): Promise<IssueRow | null> {
    const { rows } = await q.query(`${SELECT} FROM issues i WHERE i.reporter_id = $1 AND i.client_request_id = $2`, [reporterId, clientRequestId]);
    return rows[0] ?? null;
  }

  async findById(q: Queryable, id: string, lock = false): Promise<IssueRow | null> {
    const { rows } = await q.query(`${SELECT} FROM issues i WHERE i.id = $1 ${lock ? 'FOR UPDATE OF i' : ''}`, [id]);
    return rows[0] ?? null;
  }

  /** Nearest open issue of the same category inside the radius/time window (GiST-indexed ST_DWithin). */
  async findDuplicateCandidate(category: string, lat: number, lng: number, radiusM: number, windowHours: number): Promise<string | null> {
    const { rows } = await this.db.query(
      `SELECT id FROM issues
        WHERE category = $1
          AND status NOT IN ('REJECTED','DUPLICATE')
          AND created_at >= now() - ($5 * interval '1 hour')
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($3,$2),4326)::geography, $4)
        ORDER BY location <-> ST_SetSRID(ST_MakePoint($3,$2),4326)::geography
        LIMIT 1`,
      [category, lat, lng, radiusM, windowHours],
    );
    return rows[0]?.id ?? null;
  }

  async nearby(lat: number, lng: number, radiusM: number, category?: string): Promise<IssueRow[]> {
    const { rows } = await this.db.query(
      `${SELECT}, ST_Distance(i.location, p.g) AS distance_m
         FROM issues i, (SELECT ST_SetSRID(ST_MakePoint($2,$1),4326)::geography AS g) p
        WHERE ST_DWithin(i.location, p.g, $3)
          AND i.status NOT IN ('REJECTED','DUPLICATE')
          AND ($4::text IS NULL OR i.category = $4)
        ORDER BY i.location <-> p.g
        LIMIT 100`,
      [lat, lng, radiusM, category ?? null],
    );
    return rows;
  }

  /** Viewport query: only what's visible, hard-capped. Uses the GiST index via the && operator. */
  async inBBox(b: { minLng: number; minLat: number; maxLng: number; maxLat: number }, category?: string, status?: IssueStatus, limit = 500): Promise<IssueRow[]> {
    const { rows } = await this.db.query(
      `${SELECT}
         FROM issues i
        WHERE i.location && ST_MakeEnvelope($1,$2,$3,$4,4326)::geography
          AND i.status NOT IN ('REJECTED','DUPLICATE')
          AND ($5::text IS NULL OR i.category = $5)
          AND ($6::text IS NULL OR i.status = $6)
        ORDER BY i.created_at DESC
        LIMIT $7`,
      [b.minLng, b.minLat, b.maxLng, b.maxLat, category ?? null, status ?? null, limit],
    );
    return rows;
  }

  async list(f: { q?: string; category?: string; status?: IssueStatus; limit: number; offset: number }): Promise<{ rows: IssueRow[]; total: number }> {
    const where = `WHERE i.status NOT IN ('REJECTED','DUPLICATE')
                     AND ($1::text IS NULL OR i.category = $1)
                     AND ($2::text IS NULL OR i.status = $2)
                     AND ($3::text IS NULL OR strpos(lower(concat_ws(' ', i.title, i.description)), lower($3)) > 0)`;
    const [{ rows }, count] = await Promise.all([
      this.db.query(`${SELECT} FROM issues i ${where} ORDER BY i.created_at DESC LIMIT $4 OFFSET $5`, [f.category ?? null, f.status ?? null, f.q?.trim() || null, f.limit, f.offset]),
      this.db.query(`SELECT count(*)::int AS n FROM issues i ${where}`, [f.category ?? null, f.status ?? null, f.q?.trim() || null]),
    ]);
    return { rows, total: count.rows[0].n };
  }

  async history(id: string) {
    const { rows } = await this.db.query(
      `SELECT from_status AS "from", to_status AS "to", note, created_at AS "at" FROM issue_status_history WHERE issue_id = $1 ORDER BY id`,
      [id],
    );
    return rows;
  }

  addHistory(q: Queryable, issueId: string, from: string | null, to: string, actorId: string, note?: string) {
    return q.query(`INSERT INTO issue_status_history (issue_id, from_status, to_status, actor_id, note) VALUES ($1,$2,$3,$4,$5)`, [issueId, from, to, actorId, note ?? null]);
  }

  setStatus(q: Queryable, id: string, status: IssueStatus) {
    return q.query(
      `UPDATE issues SET status = $2, updated_at = now(), resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE resolved_at END WHERE id = $1`,
      [id, status],
    );
  }

  async confirm(q: Queryable, issueId: string, userId: string): Promise<boolean> {
    const ins = await q.query(`INSERT INTO issue_confirmations (issue_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [issueId, userId]);
    if (!ins.rowCount) return false;
    await q.query(`UPDATE issues SET confirmation_count = confirmation_count + 1, updated_at = now() WHERE id = $1`, [issueId]);
    return true;
  }

  follow(q: Queryable, issueId: string, userId: string) {
    return q.query(`INSERT INTO issue_followers (issue_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [issueId, userId]);
  }

  async isFollowing(q: Queryable, issueId: string, userId: string): Promise<boolean> {
    const { rows } = await q.query(
      `SELECT 1 FROM issue_followers WHERE issue_id = $1 AND user_id = $2`,
      [issueId, userId],
    );
    return rows.length > 0;
  }

  unfollow(q: Queryable, issueId: string, userId: string) {
    return q.query(`DELETE FROM issue_followers WHERE issue_id = $1 AND user_id = $2`, [issueId, userId]);
  }
    setPossibleDuplicate(q: Queryable, id: string, originalId: string) {
    return q.query(`UPDATE issues SET possible_duplicate_of = $2 WHERE id = $1`, [id, originalId]);
  }

  /**
   * Merge a duplicate into its original: everyone following the duplicate (and its reporter) now follows the original,
   * and every independent sighting — the duplicate's confirmers plus its reporter — counts as a confirmation of the
   * original, so the real problem rises in priority. The original's own reporter is never counted as a confirmer.
   */
  async mergeInto(q: Queryable, duplicateId: string, originalId: string) {
    await q.query(
      `INSERT INTO issue_followers (issue_id, user_id)
       SELECT $2::uuid, u FROM (SELECT user_id AS u FROM issue_followers WHERE issue_id = $1
                                UNION SELECT reporter_id FROM issues WHERE id = $1) x
        WHERE u <> (SELECT reporter_id FROM issues WHERE id = $2)
       ON CONFLICT DO NOTHING`, [duplicateId, originalId]);
    await q.query(
      `INSERT INTO issue_confirmations (issue_id, user_id)
       SELECT $2::uuid, u FROM (SELECT user_id AS u FROM issue_confirmations WHERE issue_id = $1
                                UNION SELECT reporter_id FROM issues WHERE id = $1) x
        WHERE u <> (SELECT reporter_id FROM issues WHERE id = $2)
       ON CONFLICT DO NOTHING`, [duplicateId, originalId]);
    await q.query(
      `UPDATE issues SET confirmation_count = (SELECT count(*)::int FROM issue_confirmations WHERE issue_id = $1), updated_at = now()
        WHERE id = $1`, [originalId]);
  }



    async countImages(q: Queryable, issueId: string): Promise<number> {
    const { rows } = await q.query(
      `SELECT count(*)::int AS n
       FROM issue_images
       WHERE issue_id = $1`,
      [issueId],
    );

    return rows[0].n;
  }

  async addImage(
    q: Queryable,
    p: {
      issueId: string;
      uploaderId: string;
      key: string;
      mime: string;
      size: number;
      width: number;
      height: number;
    },
  ) {
    const { rows } = await q.query(
      `INSERT INTO issue_images
       (issue_id, uploader_id, storage_key, mime_type, size_bytes, width, height)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (storage_key) DO NOTHING
       RETURNING id`,
      [
        p.issueId,
        p.uploaderId,
        p.key,
        p.mime,
        p.size,
        p.width,
        p.height,
      ],
    );

    return rows[0]?.id ?? null;
  }

  async images(issueId: string) {
    const { rows } = await this.db.query(
      `SELECT
         id,
         storage_key AS key,
         width,
         height
       FROM issue_images
       WHERE issue_id = $1
       ORDER BY created_at`,
      [issueId],
    );

    return rows as {
      id: string;
      key: string;
      width: number;
      height: number;
    }[];
  }
}
