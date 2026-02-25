import { Injectable } from "@nestjs/common";
import { webcrypto } from "node:crypto";
import { getResolvedAppConfig } from "../../config/env";
import { AppError } from "../../lib/errors";
import type { AuthContext, AntRole, RequestWithAuthContext } from "./auth.types";

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtClaims = Record<string, unknown> & {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
};

type Jwk = Record<string, unknown> & {
  kid?: string;
  alg?: string;
  use?: string;
  kty?: string;
};

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const v = firstString(item);
      if (v) return v;
    }
  }
  return null;
}

function lowerCsvHeader(value: string | string[] | undefined): string[] {
  const s = Array.isArray(value) ? value.join(",") : value;
  if (!s) return [];
  return s
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRoles(rawRoles: string[]): AntRole[] {
  const mapped = new Set<AntRole>();
  for (const role of rawRoles) {
    const r = role.toLowerCase();
    if (r.includes("supervisor")) mapped.add("supervisor");
    else if (r.includes("auditor")) mapped.add("auditor");
    else if (r.includes("service")) mapped.add("service");
    else if (r.includes("operator")) mapped.add("operator");
  }
  return [...mapped];
}

function rolesFromClaims(claims: Record<string, unknown>): AntRole[] {
  const collected: string[] = [];
  const direct = claims.roles;
  if (Array.isArray(direct)) collected.push(...direct.filter((v): v is string => typeof v === "string"));
  if (typeof claims.role === "string") collected.push(claims.role);
  const groups = claims.groups;
  if (Array.isArray(groups)) collected.push(...groups.filter((v): v is string => typeof v === "string"));
  const cognitoGroups = claims["cognito:groups"];
  if (Array.isArray(cognitoGroups)) {
    collected.push(...cognitoGroups.filter((v): v is string => typeof v === "string"));
  }
  const realmAccess = claims.realm_access;
  if (realmAccess && typeof realmAccess === "object") {
    const realmRoles = (realmAccess as Record<string, unknown>).roles;
    if (Array.isArray(realmRoles)) {
      collected.push(...realmRoles.filter((v): v is string => typeof v === "string"));
    }
  }
  return normalizeRoles(collected);
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function decodeJwtPart<T>(value: string): T {
  try {
    return JSON.parse(base64UrlToBuffer(value).toString("utf8")) as T;
  } catch (error) {
    throw new AppError(
      `Invalid JWT payload/header: ${error instanceof Error ? error.message : String(error)}`,
      401,
    );
  }
}

function isAudienceMatch(tokenAud: string | string[] | undefined, expected?: string): boolean {
  if (!expected) return true;
  if (!tokenAud) return false;
  if (typeof tokenAud === "string") return tokenAud === expected;
  return tokenAud.includes(expected);
}

@Injectable()
export class AuthService {
  private jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;
  private readonly jwksTtlMs = 5 * 60_000;

  async resolveRequestAuthContext(
    req: RequestWithAuthContext,
    options?: { allowAnonymous?: boolean },
  ): Promise<AuthContext> {
    const cfg = getResolvedAppConfig();
    const allowAnonymous = Boolean(options?.allowAnonymous);

    if (cfg.auth.mode === "dev_headers") {
      return this.resolveDevHeaders(req);
    }

    return this.resolveOidcJwt(req, allowAnonymous);
  }

  requireRole(ctx: AuthContext | undefined, allowed: AntRole[]): AuthContext {
    if (!ctx) throw new AppError("Authentication required", 401);
    if (ctx.source === "anonymous") throw new AppError("Authentication required", 401);
    const match = ctx.roles.some((role) => allowed.includes(role));
    if (!match) {
      throw new AppError(`Required role missing (${allowed.join(", ")})`, 403);
    }
    return ctx;
  }

  private resolveDevHeaders(req: RequestWithAuthContext): AuthContext {
    const cfg = getResolvedAppConfig();
    const roleHeader = req.headers["x-ant-role"];
    const actorHeader = req.headers["x-ant-actor-id"];
    const tenantHeader = req.headers["x-ant-tenant-id"];
    const subjectHeader = req.headers["x-ant-sub"];

    const headerRoles = lowerCsvHeader(roleHeader);
    const roles = normalizeRoles([...headerRoles, ...(headerRoles.length === 0 ? cfg.auth.devDefaultRoles : [])]);

    const tenantId = firstString(tenantHeader) ?? cfg.auth.devDefaultTenant;
    const actorId = firstString(actorHeader);
    const subject = firstString(subjectHeader) ?? actorId ?? "dev-user";

    return {
      source: "dev_headers",
      subject,
      actorId: actorId ?? subject,
      tenantId,
      roles: roles.length > 0 ? roles : ["operator"],
      claims: null,
    };
  }

  private async resolveOidcJwt(
    req: RequestWithAuthContext,
    allowAnonymous: boolean,
  ): Promise<AuthContext> {
    const cfg = getResolvedAppConfig();
    const authz = req.headers.authorization;
    const header = Array.isArray(authz) ? authz[0] : authz;
    if (!header) {
      if (allowAnonymous) {
        return {
          source: "anonymous",
          subject: null,
          actorId: null,
          tenantId: "public",
          roles: [],
          claims: null,
        };
      }
      throw new AppError("Authorization header is required", 401);
    }
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      throw new AppError("Authorization header must be Bearer token", 401);
    }
    const token = match[1];
    const claims = await this.verifyJwtWithJwks(token);

    if (cfg.auth.oidc.issuer && claims.iss !== cfg.auth.oidc.issuer) {
      throw new AppError("OIDC token issuer mismatch", 401);
    }
    if (!isAudienceMatch(claims.aud as string | string[] | undefined, cfg.auth.oidc.audience)) {
      throw new AppError("OIDC token audience mismatch", 401);
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && now >= claims.exp) {
      throw new AppError("OIDC token expired", 401);
    }
    if (typeof claims.nbf === "number" && now < claims.nbf) {
      throw new AppError("OIDC token not yet valid", 401);
    }

    const tenantClaim = cfg.auth.oidc.tenantClaim;
    const tenantId =
      firstString(claims[tenantClaim]) ??
      firstString(claims.org_id) ??
      firstString(claims.tid);
    if (!tenantId) {
      throw new AppError(
        `Tenant claim missing in OIDC token (expected ${tenantClaim}, org_id, or tid)`,
        403,
      );
    }

    const roles = rolesFromClaims(claims);
    const actorId =
      firstString(claims.preferred_username) ??
      firstString(claims.email) ??
      firstString(claims.sub);

    return {
      source: "oidc_jwt",
      subject: firstString(claims.sub),
      actorId,
      tenantId,
      roles,
      claims,
    };
  }

  private async verifyJwtWithJwks(token: string): Promise<JwtClaims> {
    const cfg = getResolvedAppConfig();
    const jwksUrl = cfg.auth.oidc.jwksUrl;
    if (!jwksUrl) {
      throw new AppError("OIDC JWKS URL not configured", 500);
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new AppError("Malformed JWT", 401);
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJwtPart<JwtHeader>(encodedHeader);
    const claims = decodeJwtPart<JwtClaims>(encodedPayload);
    const alg = header.alg;
    if (!alg || alg !== "RS256") {
      throw new AppError(`Unsupported JWT alg: ${alg ?? "missing"}`, 401);
    }
    if (!header.kid) {
      throw new AppError("JWT kid is required for JWKS verification", 401);
    }

    const jwks = await this.getJwks(jwksUrl);
    const jwk = jwks.find((k) => k.kid === header.kid);
    if (!jwk) {
      throw new AppError(`JWKS key not found for kid=${header.kid}`, 401);
    }

    const verifyInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const signature = base64UrlToBuffer(encodedSignature);

    const verifyAlgorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
    const importAlgorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

    const key = await webcrypto.subtle
      .importKey("jwk", jwk, importAlgorithm, false, ["verify"])
      .catch((error) => {
        throw new AppError(
          `Failed to import JWKS key: ${error instanceof Error ? error.message : String(error)}`,
          401,
        );
      });

    const valid = await webcrypto.subtle.verify(
      verifyAlgorithm as any,
      key,
      signature,
      verifyInput,
    );
    if (!valid) {
      throw new AppError("OIDC JWT signature verification failed", 401);
    }

    return claims;
  }

  private async getJwks(jwksUrl: string): Promise<Jwk[]> {
    const now = Date.now();
    if (this.jwksCache && now - this.jwksCache.fetchedAt < this.jwksTtlMs) {
      return this.jwksCache.keys;
    }

    const response = await fetch(jwksUrl, { method: "GET" }).catch((error) => {
      throw new AppError(
        `Failed to fetch JWKS: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    });
    if (!response.ok) {
      throw new AppError(`JWKS endpoint returned ${response.status}`, 502);
    }
    const body = (await response.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (keys.length === 0) {
      throw new AppError("JWKS response contains no keys", 502);
    }
    this.jwksCache = { fetchedAt: now, keys };
    return keys;
  }
}
