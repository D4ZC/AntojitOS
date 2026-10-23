import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { DeliveryController } from "./delivery.controller.js";
import { DeliveryService } from "./delivery.service.js";

@Module({
  imports: [AccountsModule, AuditModule, IdempotencyModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
