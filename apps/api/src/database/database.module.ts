import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service.js";
import { DATABASE, type DatabasePort } from "./database.port.js";
import { PostgresDatabase } from "./postgres-database.js";

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): DatabasePort =>
        new PostgresDatabase(config.databaseUrl),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: DatabasePort) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}

