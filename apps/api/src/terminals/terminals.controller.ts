import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { AppConfigService } from "../config/app-config.service.js";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { Public } from "../security/public.decorator.js";
import { RegisterTerminalDto } from "./dto/register-terminal.dto.js";
import { UpdateTerminalDto } from "./dto/update-terminal.dto.js";
import { TerminalsService } from "./terminals.service.js";

@ApiTags("terminals")
@Controller("v1/terminals")
export class TerminalsController {
  constructor(
    @Inject(TerminalsService) private readonly terminals: TerminalsService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post("register")
  @ApiHeader({ name: "x-bootstrap-token", required: true })
  register(
    @Headers("x-bootstrap-token") bootstrapToken: string | undefined,
    @Body() input: RegisterTerminalDto,
  ) {
    if (bootstrapToken !== this.config.bootstrapToken) {
      throw new UnauthorizedException("Token de instalación inválido");
    }
    return this.terminals.register(input);
  }

  @Patch(":terminalId")
  @ApiBearerAuth()
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("terminal.manage")
  async rename(
    @Param("terminalId") terminalId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: UpdateTerminalDto,
    @Req() request: RequestWithAuth,
  ) {
    if (!key || key.length > 128) {
      throw new BadRequestException("Se requiere Idempotency-Key válido");
    }
    const result = await this.terminals.rename(terminalId, input, key, request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
