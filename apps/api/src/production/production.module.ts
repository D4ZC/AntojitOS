import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { ProductionAgentController } from "./production-agent.controller.js";
import { ProductionController } from "./production.controller.js";
import { ProductionService } from "./production.service.js";

@Module({
  imports: [AuditModule, IdempotencyModule, OutboxModule],
  controllers: [ProductionController, ProductionAgentController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
