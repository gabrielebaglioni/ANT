import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthContext, RequestWithAuthContext } from "./auth.types";

export const PUBLIC_ROUTE_KEY = "ant:publicRoute";
export const REQUIRED_ROLES_KEY = "ant:requiredRoles";

export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);

export const RequireRoles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuthContext>();
  return req.antAuthContext as AuthContext | undefined;
});

