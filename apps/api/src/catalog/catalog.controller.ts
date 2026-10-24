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
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { CatalogService } from "./catalog.service.js";
import { CatalogPricingService } from "./catalog-pricing.service.js";
import { CreateSeasonalProductDto } from "./dto/create-seasonal-product.dto.js";
import { UpdateModifierPriceDto } from "./dto/update-modifier-price.dto.js";
import { UpdateProductPriceDto } from "./dto/update-product-price.dto.js";
import { UpdateSeasonalProductDto } from "./dto/update-seasonal-product.dto.js";
import { SeasonalProductsService } from "./seasonal-products.service.js";

const requireIdempotencyKey = (key: string | undefined): string => {
  if (!key || key.length > 128) {
    throw new BadRequestException("Se requiere Idempotency-Key válido");
  }
  return key;
};

@ApiTags("catalog")
@ApiBearerAuth()
@Controller("v1")
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(SeasonalProductsService)
    private readonly seasonalProducts: SeasonalProductsService,
    @Inject(CatalogPricingService)
    private readonly pricing: CatalogPricingService,
  ) {}

  @Get("catalog")
  @RequirePermissions("catalog.read")
  catalog(@Req() request: RequestWithAuth) {
    return this.catalogService.catalog(request.auth.siteId);
  }

  @Post("catalog/products")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("catalog.product.manage")
  async createProduct(
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateSeasonalProductDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.seasonalProducts.create(
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Patch("catalog/products/:productId")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("catalog.product.manage")
  async updateProduct(
    @Param("productId", ParseUUIDPipe) productId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: UpdateSeasonalProductDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.seasonalProducts.update(
      productId,
      input,
      requireIdempotencyKey(key),
      request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Get("service-layout")
  @RequirePermissions("service.account.read")
  serviceLayout(@Req() request: RequestWithAuth) {
    return this.catalogService.serviceLayout(request.auth.siteId);
  }

  @Patch("catalog/products/:productId/price")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("catalog.product.manage")
  async updateProductPrice(
    @Param("productId", ParseUUIDPipe) productId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ValidationPipe({
      expectedType: UpdateProductPriceDto,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })) input: UpdateProductPriceDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.pricing.updateProductPrice(
      productId, input, requireIdempotencyKey(key), request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }

  @Patch("catalog/modifiers/:modifierId/price")
  @ApiHeader({ name: "idempotency-key", required: true })
  @RequirePermissions("catalog.product.manage")
  async updateModifierPrice(
    @Param("modifierId", ParseUUIDPipe) modifierId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ValidationPipe({
      expectedType: UpdateModifierPriceDto,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })) input: UpdateModifierPriceDto,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.pricing.updateModifierPrice(
      modifierId, input, requireIdempotencyKey(key), request.auth,
    );
    return { ...result.body, idempotencyReplayed: result.replayed };
  }
}
