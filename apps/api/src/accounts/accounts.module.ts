import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { ProductionModule } from "../production/production.module.js";
import { AccountsController } from "./accounts.controller.js";
import { AccountsService } from "./accounts.service.js";

@Module({
  imports: [AuditModule, IdempotencyModule, OutboxModule, ProductionModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
