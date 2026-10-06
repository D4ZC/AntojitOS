import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { DATABASE } from "../src/database/database.port.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { TestDatabase } from "./test-database.js";

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("aplicación local", () => {
  it("inicia todos los módulos y distingue salud de disponibilidad", async () => {
    const database = new TestDatabase();
    await runMigrations(database);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE)
      .useValue(database)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix("api");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const live = await app.inject({ method: "GET", url: "/api/health/live" });
    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({
      status: "ok",
      service: "antojit-os-api",
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: "ready",
      database: "connected",
    });
  });
});

