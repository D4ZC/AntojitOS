import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { CustomersService } from "./customers.service.js";
import { CreateCustomerDto, UpdateCustomerDto } from "./dto/customer.dto.js";

const requiredKey = (key: string | undefined) => {
  if (!key || key.length > 128) throw new BadRequestException("Se requiere Idempotency-Key válido");
  return key;
};

@ApiTags("customers")
@ApiBearerAuth()
@Controller("v1/customers")
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions("customers.read")
  list(@Req() request: RequestWithAuth) { return this.customers.list(request.auth); }

  @Post()
  @RequirePermissions("customers.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async create(@Body() input: CreateCustomerDto, @Headers("idempotency-key") key: string | undefined,
    @Req() request: RequestWithAuth) {
    const result = await this.customers.create(input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Patch(":customerId")
  @RequirePermissions("customers.manage")
  @ApiHeader({ name: "idempotency-key", required: true })
  async update(@Param("customerId", ParseUUIDPipe) id: string, @Body() input: UpdateCustomerDto,
    @Headers("idempotency-key") key: string | undefined, @Req() request: RequestWithAuth) {
    const result = await this.customers.update(id, input, requiredKey(key), request.auth);
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
