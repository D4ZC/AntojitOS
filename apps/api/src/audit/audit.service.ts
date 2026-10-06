import { Injectable } from "@nestjs/common";
import type { DatabaseSession } from "../database/database.port.js";

export interface AuditEntry {
  id: string;
  siteId: string;
  actorUserId?: string;
  terminalId?: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async append(transaction: DatabaseSession, entry: AuditEntry): Promise<void> {
    await transaction.query(
      `INSERT INTO audit_events (
        id, site_id, actor_user_id, terminal_id, action, entity_type,
        entity_id, reason, changes, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
      [
        entry.id,
        entry.siteId,
        entry.actorUserId ?? null,
        entry.terminalId ?? null,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.reason ?? null,
        JSON.stringify(entry.changes ?? {}),
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  }
}

