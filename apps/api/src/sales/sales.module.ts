import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { CashModule } from "../cash/cash.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { SalesController } from "./sales.controller.js";
import { PrecheckPrintingController } from "./precheck-printing.controller.js";
import { PrecheckPrintingService } from "./precheck-printing.service.js";
import { SalesService } from "./sales.service.js";

@Module({
  imports: [AccountsModule, AuditModule, CashModule, IdempotencyModule, OutboxModule],
  controllers: [SalesController, PrecheckPrintingController],
  providers: [SalesService, PrecheckPrintingService],
  exports: [SalesService],
})
export class SalesModule {}
