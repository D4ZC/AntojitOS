import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestWithAuth } from "../security/auth-context.js";
import { Public } from "../security/public.decorator.js";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./dto/login.dto.js";

@ApiTags("session")
@Controller("v1/session")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post("pin")
  login(@Body() input: LoginDto) {
    return this.authService.login(input);
  }

  @Get()
  @ApiBearerAuth()
  current(@Req() request: RequestWithAuth) {
    return request.auth;
  }
}
