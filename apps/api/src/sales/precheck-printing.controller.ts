import { BadRequestException, Controller, Headers, Inject, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { PrecheckPrintingService } from "./precheck-printing.service.js";

@ApiTags("sales")
@ApiBearerAuth()
@Controller("v1/sales/prechecks")
export class PrecheckPrintingController {
  constructor(@Inject(PrecheckPrintingService) private readonly printing: PrecheckPrintingService) {}

  @Post(":precheckId/print")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.precheck.create")
  async print(
    @Param("precheckId", ParseUUIDPipe) precheckId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: RequestWithAuth,
  ) {
    if (!key || key.length > 128) throw new BadRequestException("Se requiere Idempotency-Key válido");
    const result = await this.printing.print(precheckId, key, request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
