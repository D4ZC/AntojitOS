import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { DATABASE, type DatabasePort, type DatabaseRow, type DatabaseSession } from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type { CreateCustomerDto, UpdateCustomerDto } from "./dto/customer.dto.js";

interface CustomerRow extends DatabaseRow {
  id: string; name: string; phone: string | null; address: string | null;
  notes: string | null; active: boolean; version: number; created_at: Date | string;
}

const customerBody = (row: CustomerRow) => ({
  id: row.id, name: row.name, phone: row.phone, address: row.address,
  notes: row.notes, active: row.active, version: row.version,
  createdAt: new Date(row.created_at).toISOString(),
});

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(actor: AuthContext) {
    const result = await this.database.query<CustomerRow>(
      "SELECT * FROM frequent_customers WHERE site_id = $1 ORDER BY active DESC, name, id",
      [actor.siteId],
    );
    return { customers: result.rows.map(customerBody) };
  }

  create(input: CreateCustomerDto, key: string, actor: AuthContext) {
    return this.idempotency.execute({ siteId: actor.siteId, scope: "customers.create", key,
      requestHash: requestHash(input) }, async (session) => {
      const result = await session.query<CustomerRow>(
        `INSERT INTO frequent_customers (id, site_id, name, phone, address, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [randomUUID(), actor.siteId, this.text(input.name, 80, true),
          this.text(input.phone, 60), this.text(input.address, 500), this.text(input.notes, 1000)],
      );
      const customer = customerBody(result.rows[0]!);
      await this.record(session, actor, "customer.created", customer.id, customer);
      return { status: 201, body: { customer } };
    });
  }

  update(id: string, input: UpdateCustomerDto, key: string, actor: AuthContext) {
    return this.idempotency.execute({ siteId: actor.siteId, scope: `customers.update:${id}`, key,
      requestHash: requestHash(input) }, async (session) => {
      const old = (await session.query<CustomerRow>(
        "SELECT * FROM frequent_customers WHERE id = $1 AND site_id = $2 FOR UPDATE",
        [id, actor.siteId],
      )).rows[0];
      if (!old) throw new NotFoundException("No existe el cliente");
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
        throw new BadRequestException("Versión inválida");
      }
      if (input.expectedVersion !== old.version) throw new ConflictException("El cliente cambió; actualiza antes de continuar");
      if (input.active !== undefined && typeof input.active !== "boolean") throw new BadRequestException("Estado de cliente inválido");
      const result = await session.query<CustomerRow>(
        `UPDATE frequent_customers SET name = $3, phone = $4, address = $5, notes = $6,
           active = $7, version = version + 1, updated_at = now()
         WHERE id = $1 AND site_id = $2 RETURNING *`,
        [id, actor.siteId, input.name === undefined ? old.name : this.text(input.name, 80, true),
          input.phone === undefined ? old.phone : this.text(input.phone, 60),
          input.address === undefined ? old.address : this.text(input.address, 500),
          input.notes === undefined ? old.notes : this.text(input.notes, 1000),
          input.active ?? old.active],
      );
      const customer = customerBody(result.rows[0]!);
      await this.record(session, actor, "customer.updated", id, { before: customerBody(old), after: customer });
      return { status: 200, body: { customer } };
    });
  }

  private async record(session: DatabaseSession, actor: AuthContext, action: string, id: string,
    changes: Record<string, unknown>) {
    await this.audit.append(session, { id: randomUUID(), siteId: actor.siteId, actorUserId: actor.userId,
      terminalId: actor.terminalId, action, entityType: "frequent_customer", entityId: id, changes });
    await this.outbox.enqueue(session, { id: randomUUID(), siteId: actor.siteId, eventType: "customers.changed",
      aggregateType: "frequent_customer", aggregateId: id, payload: { id, action } });
  }

  private text(value: string | null | undefined, maximum: number, required = false): string | null {
    if (value !== undefined && value !== null && typeof value !== "string") throw new BadRequestException("Texto inválido");
    const text = value?.trim() ?? "";
    if (text.length > maximum || (required && !text)) throw new BadRequestException("Captura un texto válido dentro de la longitud permitida");
    return text || null;
  }
}
