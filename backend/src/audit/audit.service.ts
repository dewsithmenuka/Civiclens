import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../database/database.service';

@Injectable()
export class AuditService {
  constructor(private db: Database) {}
  log(
    entry: { actorId?: string | null; action: string; entityType: string; entityId: string; metadata?: object },
    q: Queryable = this.db.pool,
  ) {
    return q.query(
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)',
      [entry.actorId ?? null, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.metadata ?? {})],
    );
  }
}
