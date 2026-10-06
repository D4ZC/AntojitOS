import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
} from "../database/database.port.js";
import {
  IdempotencyService,
  requestHash,
} from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";
import { createOpaqueToken, hashDeviceToken } from "../security/token.js";
import type { RegisterTerminalDto } from "./dto/register-terminal.dto.js";
import type { UpdateTerminalDto } from "./dto/update-terminal.dto.js";

interface SiteRow extends DatabaseRow {
  id: string;
}

interface TerminalRow extends DatabaseRow {
  id: string;
  site_id: string;
  code: string;
  display_name: string;
  profile: string;
  version: number;
}

@Injectable()
export class TerminalsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(OutboxService)
    private readonly outbox: OutboxService,
  ) {}

  async register(input: RegisterTerminalDto) {
    const deviceToken = createOpaqueToken();
    const terminalId = randomUUID();

    return this.database.transaction(async (transaction) => {
      const site = await transaction.query<SiteRow>(
        "SELECT id FROM sites WHERE code = $1",
        [input.siteCode],
      );
      const siteId = site.rows[0]?.id;
      if (!siteId) throw new NotFoundException("Sucursal inexistente");

      try {
        const result = await transaction.query<TerminalRow>(
          `INSERT INTO terminals (
            id, site_id, code, display_name, profile, device_token_hash
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, site_id, code, display_name, profile, version`,
          [
            terminalId,
            siteId,
            input.terminalCode,
            input.displayName,
            input.profile,
            hashDeviceToken(deviceToken),
          ],
        );
        const terminal = result.rows[0];
        if (!terminal) {
          throw new Error("PostgreSQL no devolvió la terminal registrada");
        }

        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId,
          terminalId,
          action: "terminal.registered",
          entityType: "terminal",
          entityId: terminalId,
          changes: { displayName: input.displayName, profile: input.profile },
        });

        return {
          id: terminal.id,
          siteId: terminal.site_id,
          code: terminal.code,
          displayName: terminal.display_name,
          profile: terminal.profile,
          version: terminal.version,
          deviceToken,
        };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictException("El código de terminal ya está registrado");
        }
        throw error;
      }
    });
  }

  rename(
    terminalId: string,
    input: UpdateTerminalDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `terminal.rename:${terminalId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const result = await transaction.query<TerminalRow>(
          `UPDATE terminals
              SET display_name = $3, version = version + 1
            WHERE id = $1 AND site_id = $2 AND version = $4 AND status = 'active'
          RETURNING id, site_id, code, display_name, profile, version`,
          [terminalId, actor.siteId, input.displayName, input.expectedVersion],
        );
        const terminal = result.rows[0];

        if (!terminal) {
          throw new ConflictException(
            "La terminal cambió o ya no está disponible; actualiza los datos",
          );
        }

        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "terminal.renamed",
          entityType: "terminal",
          entityId: terminal.id,
          changes: {
            displayName: terminal.display_name,
            version: terminal.version,
          },
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "terminal.updated",
          aggregateType: "terminal",
          aggregateId: terminal.id,
          payload: {
            id: terminal.id,
            displayName: terminal.display_name,
            version: terminal.version,
          },
        });

        return {
          status: 200,
          body: {
            id: terminal.id,
            code: terminal.code,
            displayName: terminal.display_name,
            profile: terminal.profile,
            version: terminal.version,
          },
        };
      },
    );
  }
}
