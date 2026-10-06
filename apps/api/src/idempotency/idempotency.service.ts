import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
  type DatabaseSession,
} from "../database/database.port.js";

interface IdempotencyRow extends DatabaseRow {
  request_hash: string;
  state: "processing" | "completed";
  response_status: number | null;
  response_body: Record<string, unknown> | null;
}

export interface IdempotentResponse<Body extends Record<string, unknown>> {
  status: number;
  body: Body;
  replayed: boolean;
}

export const requestHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DATABASE) private readonly database: DatabasePort) {}

  async execute<Body extends Record<string, unknown>>(
    input: {
      siteId: string;
      scope: string;
      key: string;
      requestHash: string;
    },
    operation: (transaction: DatabaseSession) => Promise<{ status: number; body: Body }>,
  ): Promise<IdempotentResponse<Body>> {
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction.query(
        `INSERT INTO idempotency_records (
          site_id, scope, idempotency_key, request_hash, state, expires_at
        ) VALUES ($1, $2, $3, $4, 'processing', now() + interval '24 hours')
        ON CONFLICT (site_id, scope, idempotency_key) DO NOTHING
        RETURNING idempotency_key`,
        [input.siteId, input.scope, input.key, input.requestHash],
      );

      if (inserted.rowCount === 0) {
        const existing = await transaction.query<IdempotencyRow>(
          `SELECT request_hash, state, response_status, response_body
             FROM idempotency_records
            WHERE site_id = $1 AND scope = $2 AND idempotency_key = $3
            FOR UPDATE`,
          [input.siteId, input.scope, input.key],
        );
        const record = existing.rows[0];

        if (!record || record.request_hash !== input.requestHash) {
          throw new ConflictException(
            "La clave de idempotencia ya fue usada con otra solicitud",
          );
        }

        if (
          record.state !== "completed" ||
          record.response_status === null ||
          record.response_body === null
        ) {
          throw new ConflictException("La solicitud con esta clave sigue en proceso");
        }

        return {
          status: record.response_status,
          body: record.response_body as Body,
          replayed: true,
        };
      }

      const response = await operation(transaction);
      await transaction.query(
        `UPDATE idempotency_records
            SET state = 'completed', response_status = $4, response_body = $5::jsonb
          WHERE site_id = $1 AND scope = $2 AND idempotency_key = $3`,
        [
          input.siteId,
          input.scope,
          input.key,
          response.status,
          JSON.stringify(response.body),
        ],
      );

      return { ...response, replayed: false };
    });
  }
}

