import { Module } from "@nestjs/common";
import { AccountingModule } from "./accounting/accounting.module.js";
import { DeliveryModule } from "./delivery/delivery.module.js";
import { CustomersModule } from "./customers/customers.module.js";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AccountsModule } from "./accounts/accounts.module.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { PermissionsGuard } from "./auth/permissions.guard.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CashModule } from "./cash/cash.module.js";
import { EventsModule } from "./events/events.module.js";
import { HealthModule } from "./health/health.module.js";
import { ProductionModule } from "./production/production.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { TerminalsModule } from "./terminals/terminals.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
    AuthModule,
    CatalogModule,
    CashModule,
    ProductionModule,
    AccountsModule,
    SalesModule,
    AccountingModule,
    DeliveryModule,
    CustomersModule,
    EventsModule,
    HealthModule,
    TerminalsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
