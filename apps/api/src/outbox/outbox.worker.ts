import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
} from "../database/database.port.js";
import { EventsGateway } from "../events/events.gateway.js";

interface OutboxRow extends DatabaseRow {
  id: string;
  site_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(EventsGateway)
    private readonly events: EventsGateway,
  ) {}

  @Interval(500)
  async publishPending(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const claimed = await this.database.transaction((transaction) =>
        transaction.query<OutboxRow>(
          `WITH candidates AS (
             SELECT id
               FROM outbox_events
              WHERE (
                status IN ('pending', 'failed') AND available_at <= now()
              ) OR (
                status = 'processing' AND claimed_at < now() - interval '1 minute'
              )
              ORDER BY created_at
              LIMIT 25
              FOR UPDATE SKIP LOCKED
           )
           UPDATE outbox_events events
              SET status = 'processing', claimed_at = now(), attempts = attempts + 1
             FROM candidates
            WHERE events.id = candidates.id
          RETURNING events.id, events.site_id, events.event_type, events.payload`,
        ),
      );

      for (const event of claimed.rows) {
        try {
          this.events.publish(event.site_id, event.event_type, event.payload);
          await this.database.query(
            `UPDATE outbox_events
                SET status = 'published', published_at = now(), last_error = NULL
              WHERE id = $1`,
            [event.id],
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error desconocido";
          this.logger.error(`No se publicó ${event.id}: ${message}`);
          await this.database.query(
            `UPDATE outbox_events
                SET status = 'failed', last_error = $2,
                    available_at = now() + interval '5 seconds'
              WHERE id = $1`,
            [event.id, message.slice(0, 500)],
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
