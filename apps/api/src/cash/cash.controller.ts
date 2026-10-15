import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { CashService } from "./cash.service.js";
import { OpenCashShiftDto } from "./dto/open-cash-shift.dto.js";

const requireIdempotencyKey = (key: string | undefined): string => {
  if (!key || key.length > 128) {
    throw new BadRequestException("Se requiere Idempotency-Key válido");
  }
  return key;
};

@ApiTags("cash")
@ApiBearerAuth()
@Controller("v1/cash")
export class CashController {
  constructor(@Inject(CashService) private readonly cash: CashService) {}

  @Get("current-shift")
  @RequirePermissions("cash.shift.read")
  currentShift(@Req() request: RequestWithAuth) {
    return this.cash.currentShift(request.auth);
  }

  @Post("shifts")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("cash.shift.open")
  async openShift(
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: OpenCashShiftDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.cash.openShift(
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
