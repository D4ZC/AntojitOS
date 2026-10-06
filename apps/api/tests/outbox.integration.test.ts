import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/database/run-migrations.js";
import type { EventsGateway } from "../src/events/events.gateway.js";
import { OutboxWorker } from "../src/outbox/outbox.worker.js";
import { TestDatabase } from "./test-database.js";

const siteId = "00000000-0000-4000-8000-000000000001";
let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("publicación outbox", () => {
  it("publica el evento confirmado y lo marca como completado", async () => {
    database = new TestDatabase();
    await runMigrations(database);
    await database.query(
      "INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')",
      [siteId],
    );
    await database.query(
      `INSERT INTO outbox_events (
        id, site_id, event_type, aggregate_type, aggregate_id, payload
      ) VALUES (
        '00000000-0000-4000-8000-000000000500', $1,
        'terminal.updated', 'terminal', 'terminal-1', '{"version":1}'::jsonb
      )`,
      [siteId],
    );

    const publish = vi.fn();
    const gateway = { publish } as unknown as EventsGateway;
    const worker = new OutboxWorker(database, gateway);
    await worker.publishPending();

    expect(publish).toHaveBeenCalledWith(siteId, "terminal.updated", {
      version: 1,
    });
    const result = await database.query<{
      status: string;
      attempts: number;
      published_at: string | null;
    }>("SELECT status, attempts, published_at FROM outbox_events");
    expect(result.rows[0]?.status).toBe("published");
    expect(result.rows[0]?.attempts).toBe(1);
    expect(result.rows[0]?.published_at).not.toBeNull();
  });
});

