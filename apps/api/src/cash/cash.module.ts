import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { CashController } from "./cash.controller.js";
import { CashService } from "./cash.service.js";

@Module({
  imports: [AuditModule, IdempotencyModule, OutboxModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
