
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { IssueStatus, REALTIME_EVENTS, Role } from '@civiclens/contracts';

import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth.types';
import { Database } from '../database/database.service';
import { ChangeStatusDto } from '../issues/dto';
import { IssuesRepository } from '../issues/issues.repository';
import { IssuesService, toView } from '../issues/issues.service';
import { LiveGateway } from '../realtime/live.gateway';
import { StorageService } from '../storage/storage.service';
import { AdminRepository } from './admin.repository';
import { HeatRepository } from './heat.repository';
import { HeatmapQuery } from './heat.dto';
import {
  HEAT_CELL_LIMIT,
  HOTSPOT_CELL_DEGREES,
  HOTSPOT_LIMIT,
  buildHeatmap,
  buildInsights,
  cellDegreesForZoom,
  statusesForScope,
} from './heat.logic';

import {
  AssignIssueDto,
  AdminIssuesQuery,
  AdminUsersQuery,
  AuditQuery,
  UpdateIssueDto,
  UpdateUserDto,
} from './dto';

const iso = (d: Date | string | null) =>
  d ? new Date(d).toISOString() : null;

@Injectable()
export class AdminService {
  constructor(
    private repo: AdminRepository,
    private issuesRepo: IssuesRepository,
    private issues: IssuesService,
    private db: Database,
    private audit: AuditService,
    private live: LiveGateway,
    private storage: StorageService,
    private heat: HeatRepository,
  ) {}

  // ───────── moderation queue ─────────

  async listIssues(q: AdminIssuesQuery) {
    if ((q.latitude === undefined) !== (q.longitude === undefined)) {
      throw new BadRequestException('Latitude and longitude must be provided together');
    }
    if (q.createdFrom && q.createdTo
      && new Date(q.createdFrom).toISOString().slice(0, 10) > new Date(q.createdTo).toISOString().slice(0, 10)) {
      throw new BadRequestException('createdFrom must be earlier than createdTo');
    }
    const { rows, total } = await this.repo.issues(q);

    return {
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        description: r.description,
        status: r.status,
        confirmationCount: r.confirmation_count,
        possibleDuplicateOf: r.possible_duplicate_of,
        assignee: r.assignee_id ? { id: r.assignee_id, displayName: r.assignee_name, role: r.assignee_role } : null,
        location: { lat: r.lat, lng: r.lng },
        locationPrecision: 'EXACT' as const,
        reporter: {
          id: r.reporter_id,
          displayName: r.reporter_name,
        },
        imageCount: r.image_count,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      })),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  async issueDetail(id: string) {
    const d = await this.repo.issueDetail(id);

    if (!d) {
      throw new NotFoundException('Issue not found');
    }

    const i = d.issue;

    return {
      id: i.id,
      category: i.category,
      title: i.title,
      description: i.description,
      status: i.status,
      confirmationCount: i.confirmation_count,
      followerCount: i.follower_count,
      location: { lat: i.lat, lng: i.lng },
      locationPrecision: 'EXACT' as const,
      reporter: {
        id: i.reporter_id,
        displayName: i.reporter_name,
      },
      assignee: i.assignee_id ? { id: i.assignee_id, displayName: i.assignee_name, role: i.assignee_role } : null,
      createdAt: iso(i.created_at),
      updatedAt: iso(i.updated_at),
      resolvedAt: iso(i.resolved_at),

      images: d.images.map((m) => ({
        id: m.id,
        url: this.storage.publicUrl(m.storage_key),
        width: m.width,
        height: m.height,
      })),

      timeline: d.timeline.map((t) => ({
        from: t.from_status,
        to: t.to_status,
        note: t.note,
        at: iso(t.created_at),
        actor: t.actor_name
          ? {
              displayName: t.actor_name,
              role: t.actor_role,
            }
          : null,
      })),
      audit: d.audit.map((a) => ({
        id: Number(a.id),
        action: a.action,
        metadata: a.metadata,
        at: iso(a.created_at),
        actor: a.actor_name ? { displayName: a.actor_name, role: a.actor_role } : null,
      })),

      // The report this issue may duplicate, including its location.
      possibleDuplicate: d.candidate && {
        id: d.candidate.id,
        title: d.candidate.title,
        status: d.candidate.status,
        category: d.candidate.category,
        confirmationCount: d.candidate.confirmation_count,
        distanceM: Math.round(d.candidate.distance_m),
        location: {
          lat: d.candidate.lat,
          lng: d.candidate.lng,
        },
        createdAt: iso(d.candidate.created_at),
      },

      // Reports that identify this issue as their probable original.
      duplicatesOfThis: d.duplicates.map((x) => ({
        id: x.id,
        title: x.title,
        status: x.status,
        createdAt: iso(x.created_at),
      })),
    };
  }

  async listAssignees() {
    const rows = await this.repo.assignees();
    return rows.map((u) => ({ id: u.id, displayName: u.display_name, role: u.role }));
  }

  async assignIssue(actor: AuthUser, id: string, dto: AssignIssueDto) {
    if (dto.assigneeId === undefined) {
      throw new BadRequestException('assigneeId is required; use null to unassign');
    }
    const assignee = await this.db.tx(async (c) => {
      const { rows: issues } = await c.query(
        `SELECT i.assigned_moderator_id, u.display_name AS assignee_name
           FROM issues i LEFT JOIN users u ON u.id = i.assigned_moderator_id
          WHERE i.id = $1 FOR UPDATE OF i`,
        [id],
      );
      if (!issues[0]) throw new NotFoundException('Issue not found');

      const assigneeId = dto.assigneeId ?? null;
      let assignee = null;
      if (assigneeId) {
        const { rows } = await c.query(
          `SELECT id, display_name, role FROM users
            WHERE id = $1 AND role IN ('MODERATOR', 'ADMIN') AND status = 'ACTIVE'
            FOR SHARE`,
          [assigneeId],
        );
        assignee = rows[0];
        if (!assignee) throw new BadRequestException('Assignee must be an active moderator or admin');
      }

      if (issues[0].assigned_moderator_id !== assigneeId) {
        await c.query(
          `UPDATE issues SET assigned_moderator_id = $2, updated_at = now() WHERE id = $1`,
          [id, assigneeId],
        );
        await this.audit.log({
          actorId: actor.sub,
          action: 'issue.assigned',
          entityType: 'issue',
          entityId: id,
          metadata: {
            from: issues[0].assigned_moderator_id,
            fromName: issues[0].assignee_name,
            to: assigneeId,
            toName: assignee?.display_name ?? null,
          },
        }, c);
      }
      return assignee ? { id: assignee.id, displayName: assignee.display_name, role: assignee.role } : null;
    });
    return { issue: await this.issueDetail(id), assignee };
  }

  /**
   * Uses the same state machine and merge logic as the public
   * moderator endpoint.
   */
  changeStatus(actor: AuthUser, id: string, dto: ChangeStatusDto) {
    return this.issues.changeStatus(actor, id, dto);
  }

  /**
   * Fix a wrong category. Changes are audited and connected maps
   * are notified.
   */
  async updateIssue(actor: AuthUser, id: string, dto: UpdateIssueDto) {
    const before = await this.issuesRepo.findById(this.db.pool, id);

    if (!before) {
      throw new NotFoundException('Issue not found');
    }

    if (before.category !== dto.category) {
      await this.db.tx(async (c) => {
        await c.query(
          `UPDATE issues
           SET category = $2, updated_at = now()
           WHERE id = $1`,
          [id, dto.category],
        );

        await this.audit.log(
          {
            actorId: actor.sub,
            action: 'issue.category_changed',
            entityType: 'issue',
            entityId: id,
            metadata: {
              from: before.category,
              to: dto.category,
            },
          },
          c,
        );
      });

      const after = (await this.issuesRepo.findById(
        this.db.pool,
        id,
      ))!;

      this.live.publish(
        REALTIME_EVENTS.ISSUE_UPDATED,
        toView(after),
      );
    }

    return this.issueDetail(id);
  }

  stats() {
    return this.repo.stats().then((s) => {
      const counts = Object.fromEntries(
        Object.values(IssueStatus).map((st) => [st, 0]),
      );

      for (const r of s.byStatus) {
        counts[r.status] = r.n;
      }

      return {
        byStatus: counts,

        byCategory: s.byCategory.map((r) => ({
          category: r.category,
          count: r.n,
        })),

        totalIssues: Object.values(counts).reduce(
          (a, b) => a + b,
          0,
        ),

        queue: {
          open: s.queue.open_queue,
          flaggedDuplicates: s.queue.flagged_duplicates,
          oldestUnreviewedHours: s.queue.oldest_unreviewed_hours,
        },

        last14Days: s.series.map((r) => ({
          day: r.day,
          created: r.created,
          resolved: r.resolved,
        })),

        resolution: {
          medianHours: s.resolution.median_hours,
          sampleSize: s.resolution.sample,
          windowDays: 90,
        },
      };
    });
  }

  // ───────── heatmap & insights ─────────

  async heatmap(q: HeatmapQuery) {
    const cell = cellDegreesForZoom(q.zoom);

    const [cells, hotspots] = await Promise.all([
      this.heat.cells({
        cell,
        days: q.days,
        statuses: statusesForScope(q.scope),
        category: q.category,
        limit: HEAT_CELL_LIMIT,
      }),

      this.heat.hotspots({
        cell: HOTSPOT_CELL_DEGREES,
        category: q.category,
        limit: HOTSPOT_LIMIT,
      }),
    ]);

    return buildHeatmap(
      {
        cell,
        scope: q.scope,
        days: q.days,
        category: q.category ?? null,
        limit: HEAT_CELL_LIMIT,
      },
      cells,
      hotspots,
    );
  }

  async insights() {
    const [resolution, buckets] = await Promise.all([
      this.heat.resolutionByCategory(),
      this.heat.backlogAge(),
    ]);

    return buildInsights(resolution, buckets);
  }

  // ───────── people & accountability (admins only) ─────────

  async listUsers(q: AdminUsersQuery) {
    const { rows, total } = await this.repo.users(q);

    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        role: u.role,
        status: u.status,
        emailVerified: u.verified,
        issueCount: u.issue_count,
        createdAt: iso(u.created_at),
      })),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateUserDto) {
    if (dto.role === undefined && dto.status === undefined) {
      throw new BadRequestException('Nothing to change');
    }

    if (id === actor.sub) {
      throw new BadRequestException(
        'You cannot change your own role or status',
      );
    }

    return this.db.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT id, email, display_name, role, status
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );

      const u = rows[0];

      if (!u) {
        throw new NotFoundException('User not found');
      }

      if (u.status === 'DELETED') {
        throw new BadRequestException(
          'This account has been deleted',
        );
      }

      const role = dto.role ?? (u.role as Role);
      const status = dto.status ?? u.status;

      await c.query(
        `UPDATE users
         SET role = $2, status = $3, updated_at = now()
         WHERE id = $1`,
        [id, role, status],
      );

      if (status === 'SUSPENDED' && u.status !== 'SUSPENDED') {
        // Revoke every session so refresh is denied and
        // FreshStaffGuard rejects the old access token immediately.
        await c.query(
          `UPDATE refresh_tokens
           SET revoked_at = now()
           WHERE user_id = $1
             AND revoked_at IS NULL`,
          [id],
        );
      }

      await this.audit.log(
        {
          actorId: actor.sub,
          action: 'user.updated',
          entityType: 'user',
          entityId: id,
          metadata: {
            before: {
              role: u.role,
              status: u.status,
            },
            after: {
              role,
              status,
            },
          },
        },
        c,
      );

      return {
        id,
        email: u.email,
        displayName: u.display_name,
        role,
        status,
      };
    });
  }

  async listAudit(q: AuditQuery) {
    const { rows, total } = await this.repo.audit(q);

    return {
      items: rows.map((a) => ({
        id: Number(a.id),
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        metadata: a.metadata,
        actor: a.actor_name
          ? {
              displayName: a.actor_name,
              role: a.actor_role,
            }
          : null,
        at: iso(a.created_at),
      })),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }
}
