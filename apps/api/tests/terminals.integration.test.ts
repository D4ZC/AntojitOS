import { ConflictException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/audit/audit.service.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { TerminalsService } from "../src/terminals/terminals.service.js";
import { TestDatabase } from "./test-database.js";

const siteId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000020";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("fundación de terminales", () => {
  it("registra, actualiza, audita y reproduce una solicitud idempotente", async () => {
    database = new TestDatabase();
    await runMigrations(database);
    await database.query(
      "INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')",
      [siteId],
    );
    await database.query(
      `INSERT INTO app_users (id, site_id, employee_code, display_name)
       VALUES ($1, $2, 'ADMIN', 'Administrador')`,
      [userId, siteId],
    );

    const service = new TerminalsService(
      database,
      new AuditService(),
      new IdempotencyService(database),
      new OutboxService(),
    );
    const registered = await service.register({
      siteCode: "PILOT",
      terminalCode: "POS-01",
      displayName: "Tablet uno",
      profile: "pos",
    });

    const actor: AuthContext = {
      sessionId: "00000000-0000-4000-8000-000000000030",
      siteId,
      userId,
      terminalId: registered.id,
      displayName: "Administrador",
      permissions: ["terminal.manage"],
    };
    const input = { displayName: "Tablet principal", expectedVersion: 0 };
    const first = await service.rename(registered.id, input, "rename-001", actor);
    const replay = await service.rename(registered.id, input, "rename-001", actor);

    expect(registered.deviceToken).toHaveLength(43);
    expect(first.body.version).toBe(1);
    expect(first.replayed).toBe(false);
    expect(replay.body).toEqual(first.body);
    expect(replay.replayed).toBe(true);

    const audit = await database.query<{ action: string }>(
      "SELECT action FROM audit_events ORDER BY occurred_at",
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "terminal.registered",
      "terminal.renamed",
    ]);

    const outbox = await database.query<{ event_type: string }>(
      "SELECT event_type FROM outbox_events",
    );
    expect(outbox.rows).toEqual([{ event_type: "terminal.updated" }]);
  });

  it("rechaza reutilizar una clave con otro contenido", async () => {
    database = new TestDatabase();
    await runMigrations(database);
    await database.query(
      "INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')",
      [siteId],
    );
    await database.query(
      `INSERT INTO app_users (id, site_id, employee_code, display_name)
       VALUES ($1, $2, 'ADMIN', 'Administrador')`,
      [userId, siteId],
    );
    const service = new TerminalsService(
      database,
      new AuditService(),
      new IdempotencyService(database),
      new OutboxService(),
    );
    const terminal = await service.register({
      siteCode: "PILOT",
      terminalCode: "POS-01",
      displayName: "Tablet uno",
      profile: "pos",
    });
    const actor: AuthContext = {
      sessionId: "00000000-0000-4000-8000-000000000030",
      siteId,
      userId,
      terminalId: terminal.id,
      displayName: "Administrador",
      permissions: ["terminal.manage"],
    };

    await service.rename(
      terminal.id,
      { displayName: "Nombre uno", expectedVersion: 0 },
      "same-key",
      actor,
    );

    await expect(
      service.rename(
        terminal.id,
        { displayName: "Nombre distinto", expectedVersion: 1 },
        "same-key",
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
