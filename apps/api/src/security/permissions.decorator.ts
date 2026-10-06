import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSIONS = "requiredPermissions";
export const RequirePermissions = (...permissions: string[]): MethodDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

