import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { CheckoutAccountDto } from "./dto/checkout-account.dto.js";
import { SalesService } from "./sales.service.js";

const requireIdempotencyKey = (key: string | undefined): string => {
  if (!key || key.length > 128) {
    throw new BadRequestException("Se requiere Idempotency-Key válido");
  }
  return key;
};

@ApiTags("sales")
@ApiBearerAuth()
@Controller("v1/sales")
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Get("payment-methods")
  @RequirePermissions("sales.payment.capture")
  paymentMethods(@Req() request: RequestWithAuth) {
    return this.sales.paymentMethods(request.auth);
  }

  @Get("receipts/:receiptId")
  @RequirePermissions("sales.receipt.read")
  receipt(
    @Param("receiptId", ParseUUIDPipe) receiptId: string,
    @Req() request: RequestWithAuth,
  ) {
    return this.sales.getReceipt(receiptId, request.auth);
  }

  @Post("accounts/:accountId/checkout")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("sales.payment.capture")
  async checkout(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CheckoutAccountDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.sales.checkout(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
