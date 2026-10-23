import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { AccountingService } from "./accounting.service.js";
import { AccountingSummaryQueryDto, CreateBillDto, CreateSupplierDto, CreateSupplierPaymentDto, UpdateSupplierDto, VoidBillDto, VoidSupplierPaymentDto } from "./dto/accounting.dto.js";

const requiredKey = (key: string | undefined) => {
  if (!key || key.length > 128) throw new BadRequestException("Se requiere Idempotency-Key válido");
  return key;
};

@ApiTags("accounting")
@ApiBearerAuth()
@Controller("v1/accounting")
export class AccountingController {
  constructor(@Inject(AccountingService) private readonly accounting: AccountingService) {}

  @Get("suppliers")
  @RequirePermissions("accounting.manage")
  suppliers(@Req() request: RequestWithAuth) { return this.accounting.suppliers(request.auth); }

  @Post("suppliers")
  @RequirePermissions("accounting.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async createSupplier(@Body() input: CreateSupplierDto, @Headers("idempotency-key") key: string | undefined,
    @Req() request: RequestWithAuth) {
    const result = await this.accounting.createSupplier(input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Patch("suppliers/:supplierId")
  @RequirePermissions("accounting.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async updateSupplier(@Param("supplierId", ParseUUIDPipe) id: string, @Body() input: UpdateSupplierDto,
    @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.accounting.updateSupplier(id, input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Get("bills")
  @RequirePermissions("accounting.manage")
  bills(@Req() request: RequestWithAuth) { return this.accounting.bills(request.auth); }

  @Post("bills")
  @RequirePermissions("accounting.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async createBill(@Body() input: CreateBillDto, @Headers("idempotency-key") key: string | undefined,
    @Req() request: RequestWithAuth) {
    const result = await this.accounting.createBill(input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("bills/:billId/payments")
  @RequirePermissions("accounting.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async payBill(@Param("billId", ParseUUIDPipe) id: string, @Body() input: CreateSupplierPaymentDto,
    @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.accounting.payBill(id, input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("bills/:billId/voids")
  @RequirePermissions("accounting.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async voidBill(@Param("billId", ParseUUIDPipe) id: string, @Body() input: VoidBillDto,
    @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.accounting.voidBill(id, input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("bills/:billId/payments/:paymentId/voids")
  @RequirePermissions("accounting.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async voidPayment(@Param("billId", ParseUUIDPipe) id: string,
    @Param("paymentId", ParseUUIDPipe) paymentId: string, @Body() input: VoidSupplierPaymentDto,
    @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.accounting.voidPayment(id, paymentId, input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Get("summary")
  @RequirePermissions("accounting.manage")
  summary(@Query() input: AccountingSummaryQueryDto, @Req() request: RequestWithAuth) {
    return this.accounting.summary(input, request.auth);
  }
}
