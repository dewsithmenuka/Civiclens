import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import sharp from 'sharp';

import {
  IssueStatus,
  IssueView,
  REALTIME_EVENTS,
  Role,
} from '@civiclens/contracts';

import { getConfig } from '../config';

import { Database } from '../database/database.service';

import { AuditService } from '../audit/audit.service';

import { LiveGateway } from '../realtime/live.gateway';

import { StorageService } from '../storage/storage.service';

import {
  ALLOWED_TYPES,
  MAX_IMAGE_BYTES,
} from '../uploads/uploads.controller';

import { AuthUser } from '../common/auth.types';

import { canTransition } from './domain/lifecycle';

import {
  AddImageDto,
  ChangeStatusDto,
  CreateIssueDto,
  ListQuery,
  MapQuery,
  NearbyQuery,
} from './dto';

import {
  IssueRow,
  IssuesRepository,
} from './issues.repository';

import { NotificationsService } from '../notifications/notifications.service';

const MAX_BBOX_DEG = 2; // refuse continent-sized viewports

export const toView = (
  r: IssueRow,
  precise = false,
): IssueView => ({
  id: r.id,

  category: r.category as IssueView['category'],

  title: r.title,

  description: r.description,

  status: r.status,

  confirmationCount: r.confirmation_count,

  possibleDuplicateOf: r.possible_duplicate_of,

  location: precise
    ? {
        lat: r.lat,
        lng: r.lng,
      }
    : {
        lat: r.public_lat,
        lng: r.public_lng,
      },

  locationPrecision: precise
    ? 'EXACT'
    : 'APPROXIMATE',

  ...(r.distance_m !== undefined
    ? {
        distanceM: Math.round(r.distance_m),
      }
    : {}),

  createdAt: new Date(
    r.created_at,
  ).toISOString(),

  updatedAt: new Date(
    r.updated_at,
  ).toISOString(),
});

const isStaff = (u?: AuthUser) =>
  u?.role === Role.MODERATOR ||
  u?.role === Role.ADMIN;

@Injectable()
export class IssuesService {
  private cfg = getConfig();

  constructor(
    private db: Database,
    private repo: IssuesRepository,
    private audit: AuditService,
    private live: LiveGateway,
    private storage: StorageService,
    private notifications: NotificationsService,
  ) {}

  async create(
    user: AuthUser,
    dto: CreateIssueDto,
  ): Promise<IssueView> {
    if (this.cfg.requireVerifiedEmail) {
      const { rows } = await this.db.query(
        `SELECT email_verified_at
         FROM users
         WHERE id = $1`,
        [user.sub],
      );

      if (!rows[0]?.email_verified_at) {
        throw new ForbiddenException(
          'Verify your email before reporting',
        );
      }
    }

    // Idempotent retry from the offline queue:
    // same (user, clientRequestId) returns the original issue.
    if (dto.clientRequestId) {
      const existing =
        await this.repo.findByClientRequest(
          this.db.pool,
          user.sub,
          dto.clientRequestId,
        );

      if (existing) {
        return toView(existing, true);
      }
    }

    const dup =
      await this.repo.findDuplicateCandidate(
        dto.category,
        dto.latitude,
        dto.longitude,
        this.cfg.duplicateRadiusM,
        this.cfg.duplicateWindowHours,
      );

    const id = await this.db.tx(async (c) => {
      const newId = await this.repo.insert(c, {
        reporterId: user.sub,
        category: dto.category,
        title: dto.title.trim(),
        description:
          dto.description?.trim(),
        lat: dto.latitude,
        lng: dto.longitude,
        clientRequestId:
          dto.clientRequestId,
        possibleDuplicateOf: dup,
      });

      if (!newId) {
        return null;
      }

      await this.repo.addHistory(
        c,
        newId,
        null,
        IssueStatus.REPORTED,
        user.sub,
      );

      return newId;
    });

    const row = id
      ? await this.repo.findById(
          this.db.pool,
          id,
        )
      : await this.repo.findByClientRequest(
          this.db.pool,
          user.sub,
          dto.clientRequestId!,
        );

    if (!row) {
      throw new ConflictException();
    }

    if (id) {
      this.live.publish(
        REALTIME_EVENTS.ISSUE_CREATED,
        toView(row),
      );
    }

    // The reporter sees their own exact pin.
    return toView(row, true);
  }

  async get(
    id: string,
    viewer?: AuthUser,
  ) {
    const row =
      await this.repo.findById(
        this.db.pool,
        id,
      );

    if (!row) {
      throw new NotFoundException(
        'Issue not found',
      );
    }

    const hidden =
      row.status ===
        IssueStatus.REJECTED ||
      row.status ===
        IssueStatus.DUPLICATE;

    const mine =
      viewer?.sub === row.reporter_id;

    if (
      hidden &&
      !isStaff(viewer) &&
      !mine
    ) {
      throw new NotFoundException(
        'Issue not found',
      );
    }

    const images = (
      await this.repo.images(id)
    ).map((i) => ({
      id: i.id,
      url: this.storage.publicUrl(
        i.key,
      ),
      width: i.width,
      height: i.height,
    }));

    return {
      ...toView(
        row,
        isStaff(viewer) || mine,
      ),
      images,
      timeline:
        await this.repo.history(id),
    };
  }

  async list(q: ListQuery) {
    const { rows, total } =
      await this.repo.list({
        q: q.q,
        category: q.category,
        status: q.status,
        limit: q.limit,
        offset: q.offset,
      });

    return {
      items: rows.map((r) =>
        toView(r),
      ),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  async nearby(q: NearbyQuery) {
    return (
      await this.repo.nearby(
        q.lat,
        q.lng,
        q.radius,
        q.category,
      )
    ).map((r) => toView(r));
  }

  async map(q: MapQuery) {
    if (
      q.minLng >= q.maxLng ||
      q.minLat >= q.maxLat
    ) {
      throw new BadRequestException(
        'Invalid bounding box',
      );
    }

    if (
      q.maxLng - q.minLng >
        MAX_BBOX_DEG ||
      q.maxLat - q.minLat >
        MAX_BBOX_DEG
    ) {
      throw new BadRequestException(
        `Viewport too large (max ${MAX_BBOX_DEG}° per side) — zoom in`,
      );
    }

    return (
      await this.repo.inBBox(
        q,
        q.category,
        q.status,
      )
    ).map((r) => toView(r));
  }

    async changeStatus(actor: AuthUser, id: string, dto: ChangeStatusDto) {
    const result = await this.db.tx(async (c) => {
      const row = await this.repo.findById(c, id, true);
      if (!row) throw new NotFoundException('Issue not found');
      if (!canTransition(row.status, dto.status)) {
        throw new BadRequestException(`Illegal transition ${row.status} → ${dto.status}`);
      }
      let originalId: string | null = null;
      if (dto.status === IssueStatus.DUPLICATE) {
        originalId = dto.duplicateOfId ?? row.possible_duplicate_of;
        if (!originalId) throw new BadRequestException('Choose the original report this duplicates (duplicateOfId)');
        if (originalId === id) throw new BadRequestException('A report cannot be a duplicate of itself');
        const original = await this.repo.findById(c, originalId);
        if (!original) throw new NotFoundException('Original report not found');
        if (original.status === IssueStatus.DUPLICATE || original.status === IssueStatus.REJECTED) {
          throw new BadRequestException('That report is closed or itself a duplicate — pick the original');
        }
      } else if (dto.duplicateOfId) {
        throw new BadRequestException('duplicateOfId is only valid when marking a report as DUPLICATE');
      }
      await this.repo.setStatus(c, id, dto.status);
      await this.repo.addHistory(c, id, row.status, dto.status, actor.sub, dto.note);
      if (originalId) {
        await this.repo.setPossibleDuplicate(c, id, originalId);
        await this.repo.mergeInto(c, id, originalId);
      }
      await this.audit.log({ actorId: actor.sub, action: 'issue.status_changed', entityType: 'issue', entityId: id, metadata: { from: row.status, to: dto.status, ...(originalId ? { duplicateOf: originalId } : {}) } }, c);
      return { from: row.status, originalId };
    });
    const updated = (await this.repo.findById(this.db.pool, id))!;
    this.live.publish(REALTIME_EVENTS.ISSUE_STATUS_CHANGED, toView(updated));
    if (dto.status === IssueStatus.RESOLVED) this.live.publish(REALTIME_EVENTS.ISSUE_RESOLVED, toView(updated));
    void this.notifications.issueStatusChanged({ id, title: updated.title, reporterId: updated.reporter_id }, actor.sub, dto.status);
    if (result.originalId) {
      // The original just gained confirmations: tell connected maps its new count.
      const original = await this.repo.findById(this.db.pool, result.originalId);
      if (original) this.live.publish(REALTIME_EVENTS.ISSUE_UPDATED, toView(original));
    }
    return { ...toView(updated, true), previousStatus: result.from, mergedInto: result.originalId };
  }

  async confirm(
    user: AuthUser,
    id: string,
  ) {
    const row =
      await this.repo.findById(
        this.db.pool,
        id,
      );

    if (!row) {
      throw new NotFoundException(
        'Issue not found',
      );
    }

    if (
      row.reporter_id === user.sub
    ) {
      throw new ForbiddenException(
        'You cannot confirm your own report',
      );
    }

    if (
      row.status ===
        IssueStatus.REJECTED ||
      row.status ===
        IssueStatus.DUPLICATE ||
      row.status ===
        IssueStatus.RESOLVED
    ) {
      throw new BadRequestException(
        'This issue is closed',
      );
    }

    const added = await this.db.tx(
      (c) =>
        this.repo.confirm(
          c,
          id,
          user.sub,
        ),
    );

    const fresh =
      await this.repo.findById(
        this.db.pool,
        id,
      );

    if (!fresh) {
      throw new NotFoundException(
        'Issue not found',
      );
    }

    if (added) {
      this.live.publish(
        REALTIME_EVENTS.ISSUE_CONFIRMED,
        toView(fresh),
      );

      void this.notifications.issueConfirmed(
        {
          id,
          title: fresh.title,
          reporterId:
            fresh.reporter_id,
        },
        user.sub,
      );
    }

    return {
      confirmed: true,
      confirmationCount:
        fresh.confirmation_count,
    };
  }

  async follow(
    user: AuthUser,
    id: string,
    on: boolean,
  ) {
    const row =
      await this.repo.findById(
        this.db.pool,
        id,
      );

    if (!row) {
      throw new NotFoundException(
        'Issue not found',
      );
    }

    await (
      on
        ? this.repo.follow(
            this.db.pool,
            id,
            user.sub,
          )
        : this.repo.unfollow(
            this.db.pool,
            id,
            user.sub,
          )
    );

    return {
      following: on,
    };
  }

  async isFollowing(user: AuthUser, id: string): Promise<{ following: boolean }> {
    const row = await this.repo.findById(this.db.pool, id);
    if (!row) throw new NotFoundException('Issue not found');
    const following = await this.repo.isFollowing(this.db.pool, id, user.sub);
    return { following };
  }

  /**
   * Step 2 of the upload flow:
   * verify the object really exists with a sane
   * type/size, then record its metadata.
   */
  async addImage(
    user: AuthUser,
    id: string,
    dto: AddImageDto,
  ) {
    const row =
      await this.repo.findById(
        this.db.pool,
        id,
      );

    if (!row) {
      throw new NotFoundException(
        'Issue not found',
      );
    }

    if (
      row.reporter_id !== user.sub
    ) {
      throw new ForbiddenException(
        'Only the reporter can attach images',
      );
    }

    if (
      !dto.key.startsWith(
        `issues/${user.sub}/`,
      )
    ) {
      throw new ForbiddenException(
        'Upload slot belongs to another user',
      );
    }

    const obj =
      await this.storage.head(
        dto.key,
      );

    if (!obj) {
      throw new BadRequestException(
        'Object not found — upload it before registering',
      );
    }

    const mime =
      obj.contentType ?? '';

    if (!(mime in ALLOWED_TYPES)) {
      throw new BadRequestException(
        'Unsupported image type',
      );
    }

    if (
      obj.sizeBytes < 1 ||
      obj.sizeBytes >
        MAX_IMAGE_BYTES
    ) {
      throw new BadRequestException(
        'Image too large (max 5 MB)',
      );
    }

    const source = await this.storage.get(
      dto.key,
    );
    const image = sharp(source, {
      limitInputPixels: 40_000_000,
    }).rotate();
    let metadata;

    try {
      metadata = await image.metadata();
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(
          'Image data is invalid',
        );
      }
      throw error;
    }

    const expectedFormat =
      mime === 'image/jpeg'
        ? 'jpeg'
        : mime.slice('image/'.length);

    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 10000 ||
      metadata.height > 10000
    ) {
      throw new BadRequestException(
        'Image data does not match its declared type or dimensions',
      );
    }

    let sanitized;

    try {
      const pipeline =
        mime === 'image/jpeg'
          ? image.jpeg({ quality: 85 })
          : mime === 'image/png'
            ? image.png({ compressionLevel: 9 })
            : image.webp({ quality: 85 });
      sanitized = await pipeline.toBuffer({
        resolveWithObject: true,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(
          'Image data could not be sanitized',
        );
      }
      throw error;
    }

    if (
      sanitized.data.length < 1 ||
      sanitized.data.length > MAX_IMAGE_BYTES
    ) {
      throw new BadRequestException(
        'Sanitized image exceeds the 5 MB limit',
      );
    }

    await this.storage.put(
      dto.key,
      sanitized.data,
      mime,
    );

    const imageId =
      await this.db.tx(async (c) => {
        if (
          (await this.repo.countImages(
            c,
            id,
          )) >= 4
        ) {
          throw new BadRequestException(
            'Maximum 4 images per issue',
          );
        }

        return this.repo.addImage(
          c,
          {
            issueId: id,
            uploaderId: user.sub,
            key: dto.key,
            mime,
            size: sanitized.data.length,
            width: sanitized.info.width,
            height: sanitized.info.height,
          },
        );
      });

    return {
      id: imageId,
      url: this.storage.publicUrl(
        dto.key,
      ),
      width: sanitized.info.width,
      height: sanitized.info.height,
    };
  }
}
