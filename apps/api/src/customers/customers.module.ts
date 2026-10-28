import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersService } from "./customers.service.js";

@Module({ imports: [AuditModule, IdempotencyModule, OutboxModule], controllers: [CustomersController],
  providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
