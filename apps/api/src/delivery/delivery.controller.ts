import {
  BadRequestException, Body, Controller, Get, Header, Headers, Inject, Param,
  ParseUUIDPipe, Patch, Post, Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { Public } from "../security/public.decorator.js";
import { DeliveryService } from "./delivery.service.js";
import {
  CreateDeliveryAssignmentDto, CreateDeliveryDriverDto, DeliveryVersionDto,
  RefreshDeliveryAssignmentDto, UpdateDeliveryStatusDto,
} from "./dto/delivery.dto.js";

const requireKey = (key: string | undefined) => {
  if (!key || key.length > 128) throw new BadRequestException("Se requiere Idempotency-Key válido");
  return key;
};

@ApiTags("delivery")
@ApiBearerAuth()
@Controller("v1/delivery")
export class DeliveryController {
  constructor(@Inject(DeliveryService) private readonly delivery: DeliveryService) {}

  @Get("drivers")
  @RequirePermissions("delivery.manage")
  drivers(@Req() request: RequestWithAuth) {
    return this.delivery.drivers(request.auth);
  }

  @Post("drivers")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("delivery.manage")
  async createDriver(@Body() input: CreateDeliveryDriverDto, @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.delivery.createDriver(input, requireKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Get("assignments")
  @RequirePermissions("delivery.manage")
  assignments(@Req() request: RequestWithAuth) {
    return this.delivery.assignments(request.auth);
  }

  @Post("assignments")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("delivery.manage")
  async createAssignment(@Body() input: CreateDeliveryAssignmentDto, @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.delivery.createAssignment(input, requireKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Patch("assignments/:id/status")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("delivery.manage")
  async status(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateDeliveryStatusDto, @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.delivery.updateStatus(id, input, requireKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("assignments/:id/refresh")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("delivery.manage")
  async refresh(@Param("id", ParseUUIDPipe) id: string, @Body() input: RefreshDeliveryAssignmentDto, @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.delivery.refresh(id, input, requireKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Post("assignments/:id/share")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("delivery.manage")
  share(@Param("id", ParseUUIDPipe) id: string, @Body() input: DeliveryVersionDto, @Req() request: RequestWithAuth) {
    return this.delivery.share(id, input, request.auth);
  }

  @Get("shared")
  @Public()
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiHeader({ name: "x-delivery-token", required: true })
  shared(@Headers("x-delivery-token") token: string | undefined) {
    return this.delivery.shared(token);
  }
}
