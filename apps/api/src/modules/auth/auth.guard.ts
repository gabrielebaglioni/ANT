import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { PUBLIC_ROUTE_KEY, REQUIRED_ROLES_KEY } from "./auth.decorators";
import type { RequestWithAuthContext } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<RequestWithAuthContext>();
    const authCtx = await this.authService.resolveRequestAuthContext(req, {
      allowAnonymous: Boolean(isPublic),
    });
    req.antAuthContext = authCtx;

    if (requiredRoles && requiredRoles.length > 0) {
      this.authService.requireRole(
        authCtx,
        requiredRoles as ("operator" | "supervisor" | "auditor" | "service")[],
      );
    }

    return true;
  }
}
