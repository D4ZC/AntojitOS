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
import { CancelOrderItemDto } from "./dto/cancel-order-item.dto.js";
import { OpenAccountDto } from "./dto/open-account.dto.js";
import { SendRoundDto } from "./dto/send-round.dto.js";
import { UpdateOrderItemDto } from "./dto/update-order-item.dto.js";

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

  @Get(":accountId")
  @RequirePermissions("service.account.read")
  get(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Req() request: RequestWithAuth,
  ) {
    return this.accounts.get(accountId, request.auth);
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
}
