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
import { RefundReceiptDto } from "./dto/refund-receipt.dto.js";
import { ReprintReceiptDto } from "./dto/reprint-receipt.dto.js";
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

  @Get("receipts")
  @RequirePermissions("sales.receipt.read")
  receipts(@Req() request: RequestWithAuth) {
    return this.sales.recentReceipts(request.auth);
  }

  @Get("receipts/:receiptId")
  @RequirePermissions("sales.receipt.read")
  receipt(
    @Param("receiptId", ParseUUIDPipe) receiptId: string,
    @Req() request: RequestWithAuth,
  ) {
    return this.sales.getReceipt(receiptId, request.auth);
  }

  @Post("receipts/:receiptId/reprints")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("sales.receipt.reprint")
  async reprintReceipt(
    @Param("receiptId", ParseUUIDPipe) receiptId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ReprintReceiptDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.sales.reprintReceipt(
      receiptId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("receipts/:receiptId/refunds")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("sales.refund.create")
  async refundReceipt(
    @Param("receiptId", ParseUUIDPipe) receiptId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: RefundReceiptDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.sales.refundReceipt(
      receiptId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
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
