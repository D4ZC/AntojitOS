import { Injectable } from "@nestjs/common";
import type { DatabaseSession } from "../database/database.port.js";

@Injectable()
export class OutboxService {
  async enqueue(
    transaction: DatabaseSession,
    event: {
      id: string;
      siteId: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO outbox_events (
        id, site_id, event_type, aggregate_type, aggregate_id, payload
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        event.id,
        event.siteId,
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        JSON.stringify(event.payload),
      ],
    );
  }
}

