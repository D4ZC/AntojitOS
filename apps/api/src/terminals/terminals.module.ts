import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { TerminalsController } from "./terminals.controller.js";
import { TerminalsService } from "./terminals.service.js";

@Module({
  imports: [AuditModule, IdempotencyModule, OutboxModule],
  controllers: [TerminalsController],
  providers: [TerminalsService],
})
export class TerminalsModule {}
