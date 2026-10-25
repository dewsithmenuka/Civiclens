import { Injectable } from '@nestjs/common';
import { Database } from '../database/database.service';
import { BucketRow, CellRow, HotspotRow, OPEN_STATUSES, ResolutionRow } from './heat.logic';

@Injectable()
export class HeatRepository {
  constructor(private db: Database) {}

  /**
   * Counts per grid cell. ST_SnapToGrid rounds each point to the nearest grid node, so the node is the centre of its cell.
   * `days = 0` means all time — an open report from last year is still a problem, so it is never aged out of the "open" view.
   */
  async cells(f: { cell: number; days: number; statuses: string[]; category?: string; limit: number }): Promise<CellRow[]> {
    const { rows } = await this.db.query(
      `SELECT ST_Y(g) AS lat, ST_X(g) AS lng, n, open_n, oldest_open_hours
         FROM (
           SELECT ST_SnapToGrid(i.location::geometry, $1::float8) AS g,
                  count(*)::int AS n,
                  count(*) FILTER (WHERE i.status = ANY($6::text[]))::int AS open_n,
                  COALESCE(round(max(extract(epoch FROM (now() - i.created_at)) / 3600)
                                 FILTER (WHERE i.status = ANY($6::text[])))::int, 0) AS oldest_open_hours
             FROM issues i
            WHERE ($2::int = 0 OR i.created_at >= now() - ($2::int * interval '1 day'))
              AND i.status = ANY($3::text[])
              AND ($4::text IS NULL OR i.category = $4)
            GROUP BY 1
            ORDER BY n DESC, ST_X(ST_SnapToGrid(i.location::geometry, $1::float8)), ST_Y(ST_SnapToGrid(i.location::geometry, $1::float8))
            LIMIT $5
         ) t`,
      [f.cell, f.days, f.statuses, f.category ?? null, f.limit, [...OPEN_STATUSES]],
    );
    return rows;
  }

  /** The busiest ~550 m areas by open reports, with each area's most common category. */
  async hotspots(f: { cell: number; category?: string; limit: number }): Promise<HotspotRow[]> {
    const { rows } = await this.db.query(
      `SELECT ST_Y(g) AS lat, ST_X(g) AS lng, count(*)::int AS open_n,
              mode() WITHIN GROUP (ORDER BY category) AS top_category,
              round(max(age_h))::int AS oldest_hours,
              COALESCE(sum(confirmations), 0)::int AS confirmations
         FROM (SELECT ST_SnapToGrid(location::geometry, $1::float8) AS g, category,
                      extract(epoch FROM (now() - created_at)) / 3600 AS age_h, confirmation_count AS confirmations
                 FROM issues
                WHERE status = ANY($2::text[]) AND ($3::text IS NULL OR category = $3)) s
        GROUP BY g
        ORDER BY open_n DESC, confirmations DESC, oldest_hours DESC
        LIMIT $4`,
      [f.cell, [...OPEN_STATUSES], f.category ?? null, f.limit],
    );
    return rows;
  }

  async resolutionByCategory(): Promise<ResolutionRow[]> {
    const { rows } = await this.db.query(
      `SELECT category,
              count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
              count(*) FILTER (WHERE status = ANY($1::text[]))::int AS open,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_at - created_at)) / 3600)
                     FILTER (WHERE status = 'RESOLVED' AND resolved_at IS NOT NULL))::numeric, 1)::float AS median_hours
         FROM issues
        WHERE status NOT IN ('REJECTED', 'DUPLICATE')
        GROUP BY category
        ORDER BY open DESC, category`,
      [[...OPEN_STATUSES]],
    );
    return rows;
  }

  async backlogAge(): Promise<BucketRow[]> {
    const { rows } = await this.db.query(
      `SELECT CASE WHEN age < interval '1 day' THEN 'lt1d'
                   WHEN age < interval '3 days' THEN '1to3d'
                   WHEN age < interval '7 days' THEN '3to7d'
                   ELSE 'gt7d' END AS bucket,
              count(*)::int AS n
         FROM (SELECT now() - created_at AS age FROM issues WHERE status = ANY($1::text[])) s
        GROUP BY 1`,
      [[...OPEN_STATUSES]],
    );
    return rows;
  }
}