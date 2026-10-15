import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";
import { AppConfigService } from "../config/app-config.service.js";
import { Public } from "../security/public.decorator.js";
import { CompletePrintJobDto } from "./dto/complete-print-job.dto.js";
import { FailPrintJobDto } from "./dto/fail-print-job.dto.js";
import { RegisterProductionAgentDto } from "./dto/register-production-agent.dto.js";
import { ProductionService } from "./production.service.js";

@ApiTags("production-agent")
@Public()
@Controller("v1")
export class ProductionAgentController {
  constructor(
    @Inject(ProductionService) private readonly production: ProductionService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Post("production-agents/register")
  @ApiHeader({ name: "x-bootstrap-token", required: true })
  register(
    @Headers("x-bootstrap-token") bootstrapToken: string | undefined,
    @Body() input: RegisterProductionAgentDto,
  ) {
    if (bootstrapToken !== this.config.bootstrapToken) {
      throw new UnauthorizedException("Token de instalación inválido");
    }
    return this.production.registerAgent(input);
  }

  @Post("production-agent/jobs/claim")
  @ApiHeader({ name: "x-agent-id", required: true })
  @ApiHeader({ name: "x-agent-token", required: true })
  claim(
    @Headers("x-agent-id") agentId: string | undefined,
    @Headers("x-agent-token") token: string | undefined,
  ) {
    return this.production.claimJob(agentId, token);
  }

  @Post("production-agent/jobs/:jobId/complete")
  @ApiHeader({ name: "x-agent-id", required: true })
  @ApiHeader({ name: "x-agent-token", required: true })
  complete(
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Headers("x-agent-id") agentId: string | undefined,
    @Headers("x-agent-token") token: string | undefined,
    @Body() input: CompletePrintJobDto,
  ) {
    return this.production.completeJob(jobId, input.claimToken, agentId, token);
  }

  @Post("production-agent/jobs/:jobId/fail")
  @ApiHeader({ name: "x-agent-id", required: true })
  @ApiHeader({ name: "x-agent-token", required: true })
  fail(
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Headers("x-agent-id") agentId: string | undefined,
    @Headers("x-agent-token") token: string | undefined,
    @Body() input: FailPrintJobDto,
  ) {
    return this.production.failJob(
      jobId,
      input.claimToken,
      input.error,
      agentId,
      token,
    );
  }
}
