import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { AccountsService } from "./accounts.service.js";
import { AddOrderItemDto } from "./dto/add-order-item.dto.js";
import { ApplyAccountAdjustmentDto } from "./dto/apply-account-adjustment.dto.js";
import { CancelAccountDto } from "./dto/cancel-account.dto.js";
import { CancelOrderItemDto } from "./dto/cancel-order-item.dto.js";
import { CreatePrecheckDto } from "./dto/create-precheck.dto.js";
import { MergeAccountDto } from "./dto/merge-account.dto.js";
import { OpenAccountDto } from "./dto/open-account.dto.js";
import { SendRoundDto } from "./dto/send-round.dto.js";
import { SplitAccountDto } from "./dto/split-account.dto.js";
import { TransferAccountItemsDto } from "./dto/transfer-account-items.dto.js";
import { UpdateAccountContextDto } from "./dto/update-account-context.dto.js";
import { UpdateOrderItemDto } from "./dto/update-order-item.dto.js";
import { VoidAccountAdjustmentDto } from "./dto/void-account-adjustment.dto.js";

const requireIdempotencyKey = (key: string | undefined): string => {
  if (!key || key.length > 128) {
    throw new BadRequestException("Se requiere Idempotency-Key válido");
  }
  return key;
};

@ApiTags("service-accounts")
@ApiBearerAuth()
@Controller("v1/accounts")
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get("open-counter")
  @RequirePermissions("service.account.read")
  listOpenCounter(@Req() request: RequestWithAuth) {
    return this.accounts.listOpenCounter(request.auth);
  }

  @Get("table/:tableId")
  @RequirePermissions("service.account.read")
  listByTable(
    @Param("tableId", ParseUUIDPipe) tableId: string,
    @Req() request: RequestWithAuth,
  ) {
    return this.accounts.listByTable(tableId, request.auth);
  }

  @Get(":accountId")
  @RequirePermissions("service.account.read")
  get(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Req() request: RequestWithAuth,
  ) {
    return this.accounts.get(accountId, request.auth);
  }

  @Get(":accountId/management-options")
  @RequirePermissions("service.account.manage")
  managementOptions(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Req() request: RequestWithAuth,
  ) {
    return this.accounts.managementOptions(accountId, request.auth);
  }

  @Post()
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.open")
  async open(
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: OpenAccountDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.open(
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/items")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.item.add")
  async addItem(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: AddOrderItemDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.addItem(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Patch(":accountId/items/:itemId")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.item.edit")
  async updateItem(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: UpdateOrderItemDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.updateItem(
      accountId,
      itemId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/rounds")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.round.send")
  async sendRound(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: SendRoundDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.sendRound(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/items/:itemId/cancellations")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.item.cancel")
  async cancelItem(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CancelOrderItemDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.cancelItem(
      accountId,
      itemId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/adjustments")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.discount")
  async applyAdjustment(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ApplyAccountAdjustmentDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.applyAdjustment(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/adjustments/:adjustmentId/voids")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.discount")
  async voidAdjustment(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Param("adjustmentId", ParseUUIDPipe) adjustmentId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: VoidAccountAdjustmentDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.voidAdjustment(
      accountId,
      adjustmentId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/prechecks")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.precheck.create")
  async createPrecheck(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreatePrecheckDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.createPrecheck(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/cancellations")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.manage")
  async cancelAccount(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CancelAccountDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.cancelAccount(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Patch(":accountId/context")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.manage")
  async updateContext(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: UpdateAccountContextDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.updateContext(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/splits")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.manage")
  async split(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: SplitAccountDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.split(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/transfers")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.manage")
  async transferItems(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: TransferAccountItemsDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.transferItems(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post(":accountId/merges")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.account.manage")
  async merge(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: MergeAccountDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.accounts.merge(
      accountId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
