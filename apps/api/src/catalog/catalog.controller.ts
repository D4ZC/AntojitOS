import { Controller, Get, Inject, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { RequirePermissions } from "../security/permissions.decorator.js";
import { CatalogService } from "./catalog.service.js";

@ApiTags("catalog")
@ApiBearerAuth()
@Controller("v1")
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

  @Get("catalog")
  @RequirePermissions("catalog.read")
  catalog(@Req() request: RequestWithAuth) {
    return this.catalogService.catalog(request.auth.siteId);
  }

  @Get("service-layout")
  @RequirePermissions("service.account.read")
  serviceLayout(@Req() request: RequestWithAuth) {
    return this.catalogService.serviceLayout(request.auth.siteId);
  }
}

