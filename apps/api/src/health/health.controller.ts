import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  DATABASE,
  type DatabasePort,
} from "../database/database.port.js";
import { Public } from "../security/public.decorator.js";

@ApiTags("health")
@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: DatabasePort) {}

  @Get("live")
  live() {
    return {
      status: "ok",
      service: "antojit-os-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async ready() {
    try {
      await this.database.query("SELECT 1 AS ready");
      return { status: "ready", database: "connected" };
    } catch {
      throw new ServiceUnavailableException({
        status: "not-ready",
        database: "unavailable",
      });
    }
  }
}

