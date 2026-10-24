import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogPricingService } from "./catalog-pricing.service.js";
import { CatalogService } from "./catalog.service.js";
import { SeasonalProductsService } from "./seasonal-products.service.js";

@Module({
  imports: [AuditModule, IdempotencyModule],
  controllers: [CatalogController],
  providers: [CatalogService, SeasonalProductsService, CatalogPricingService],
  exports: [CatalogService],
})
export class CatalogModule {}
