export type AntRole = "operator" | "supervisor" | "auditor" | "service";

export interface AuthContext {
  source: "dev_headers" | "oidc_jwt" | "anonymous";
  subject: string | null;
  actorId: string | null;
  tenantId: string;
  roles: AntRole[];
  claims: Record<string, unknown> | null;
}

export interface RequestWithAuthContext {
  antAuthContext?: AuthContext;
  headers: Record<string, string | string[] | undefined>;
}

