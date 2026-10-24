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
import { ReprintTicketDto } from "./dto/reprint-ticket.dto.js";
import { TransitionTicketDto } from "./dto/transition-ticket.dto.js";
import { ProductionService } from "./production.service.js";

const requireIdempotencyKey = (key: string | undefined): string => {
  if (!key || key.length > 128) {
    throw new BadRequestException("Se requiere Idempotency-Key válido");
  }
  return key;
};

@ApiTags("production")
@ApiBearerAuth()
@Controller("v1/production")
export class ProductionController {
  constructor(
    @Inject(ProductionService) private readonly production: ProductionService,
  ) {}

  @Get("tickets")
  @RequirePermissions("production.ticket.read")
  list(@Req() request: RequestWithAuth) {
    return this.production.listTickets(request.auth.siteId);
  }

  @Patch("tickets/:ticketId")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("production.ticket.update")
  async transition(
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: TransitionTicketDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.production.transition(
      ticketId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("tickets/:ticketId/reprints")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("production.job.reprint")
  async reprint(
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ReprintTicketDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.production.reprint(
      ticketId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("tickets/:ticketId/print")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("service.round.send")
  async print(
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.production.print(
      ticketId,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
