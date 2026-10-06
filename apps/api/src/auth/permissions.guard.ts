import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RequestWithAuth } from "../security/auth-context.js";
import { REQUIRED_PERMISSIONS } from "../security/permissions.decorator.js";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const granted = new Set(request.auth.permissions);
    if (!required.every((permission) => granted.has(permission))) {
      throw new ForbiddenException("Permiso insuficiente");
    }

    return true;
  }
}
