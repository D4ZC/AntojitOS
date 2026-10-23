import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { AccountingController } from "./accounting.controller.js";
import { AccountingService } from "./accounting.service.js";

@Module({ imports: [AuditModule, IdempotencyModule, OutboxModule], controllers: [AccountingController],
  providers: [AccountingService], exports: [AccountingService] })
export class AccountingModule {}
