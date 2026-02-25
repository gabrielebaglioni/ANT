import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { ANT_DEMO_MULTI_ENTITY_TENANT_ID, isValidTenantId } from "@ant/shared";
import { AppError } from "../lib/errors";

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  APP_RUNTIME: z.enum(["development", "deploy"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DOTENV_PATH: z.string().optional(),

  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().optional(),
  PGPORT: z.string().optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().optional(),
  PGSSL: z.string().optional(),
  PGPOOL_MAX: z.string().optional(),

  MINIO_ENDPOINT: z.string().default("127.0.0.1"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .optional()
    .default("false"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("ant-attachments"),
  MINIO_REGION: z.string().default("us-east-1"),

  OUTBOX_WORKER_ENABLED: z.string().optional().default("true"),
  OUTBOX_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  RECONCILIATION_ENABLED: z.string().optional().default("true"),
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  MONITORING_ENABLED: z.string().optional().default("true"),
  MONITORING_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  ALERT_WEBHOOK_URL: z.string().optional(),
  ALERT_OUTBOX_MAX_LAG_SECONDS: z.coerce.number().int().positive().default(120),
  ALERT_OUTBOX_RETRYING_JOBS: z.coerce.number().int().min(0).default(5),
  ALERT_RECON_MISMATCHES_24H: z.coerce.number().int().min(0).default(1),
  ALERT_RECON_FAILURES_1H: z.coerce.number().int().min(0).default(1),
  ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(300000),

  AUTH_MODE: z.enum(["dev_headers", "oidc_jwt"]).default("dev_headers"),
  AUTH_OIDC_ISSUER: z.string().optional(),
  AUTH_OIDC_AUDIENCE: z.string().optional(),
  AUTH_OIDC_JWKS_URL: z.string().optional(),
  AUTH_TENANT_CLAIM: z.string().default("tenant_id"),
  AUTH_DEV_DEFAULT_TENANT: z
    .string()
    .default(ANT_DEMO_MULTI_ENTITY_TENANT_ID)
    .refine(isValidTenantId, "Invalid tenant id format (expected tenant-<slug>)"),
  AUTH_DEV_DEFAULT_ROLES: z.string().default("operator"),

  ADMIN_COMPENSATION_REQUIRE_APPROVAL: z.string().optional().default("true"),

  AUDIT_WORM_ARCHIVE_URL: z.string().optional(),
  AUDIT_WORM_REQUIRED_IN_DEPLOY: z.string().optional().default("false"),

  IOTA_NETWORK: z.enum(["local", "testnet", "mainnet"]).default("local"),
  IOTA_MODE: z.enum(["auto", "relay", "sdk", "stub"]).default("auto"),
  IOTA_ALLOW_STUBS: z.string().optional().default("false"),
  IOTA_NOTARIZATION_DISABLE_SDK: z.string().optional(),
  IOTA_KEY_SOURCE: z
    .enum(["env", "relay_kms", "relay_hsm", "vault", "external_signer"])
    .default("env"),
  IOTA_ALLOW_ENV_SECRET_IN_DEPLOY: z.string().optional().default("false"),

  IOTA_RELAY_API_KEY: z.string().optional(),
  IOTA_TESTNET_RELAY_API_KEY: z.string().optional(),
  IOTA_MAINNET_RELAY_API_KEY: z.string().optional(),
  IOTA_LOCAL_RELAY_API_KEY: z.string().optional(),

  IOTA_TX_RELAY_URL: z.string().optional(),
  IOTA_NOTARIZATION_RELAY_URL: z.string().optional(),
  IOTA_FULLNODE_URL: z.string().optional(),
  IOTA_PACKAGE_ID: z.string().optional(),
  IOTA_ADMIN_SECRET_KEY: z.string().optional(),
  IOTA_DID_ADDRESS_MAP_JSON: z.string().optional(),

  IOTA_LOCAL_TX_RELAY_URL: z.string().optional(),
  IOTA_LOCAL_NOTARIZATION_RELAY_URL: z.string().optional(),
  IOTA_LOCAL_FULLNODE_URL: z.string().optional(),
  IOTA_LOCAL_PACKAGE_ID: z.string().optional(),

  IOTA_TESTNET_TX_RELAY_URL: z.string().optional(),
  IOTA_TESTNET_NOTARIZATION_RELAY_URL: z.string().optional(),
  IOTA_TESTNET_FULLNODE_URL: z.string().optional(),
  IOTA_TESTNET_PACKAGE_ID: z.string().optional(),

  IOTA_MAINNET_TX_RELAY_URL: z.string().optional(),
  IOTA_MAINNET_NOTARIZATION_RELAY_URL: z.string().optional(),
  IOTA_MAINNET_FULLNODE_URL: z.string().optional(),
  IOTA_MAINNET_PACKAGE_ID: z.string().optional(),
});

export type ParsedApiEnv = z.infer<typeof EnvSchema>;

export interface ResolvedIotaConfig {
  network: "local" | "testnet" | "mainnet";
  mode: "auto" | "relay" | "sdk" | "stub";
  allowStubs: boolean;
  disableNotarizationSdk: boolean;
  txRelayUrl?: string;
  notarizationRelayUrl?: string;
  relayApiKey?: string;
  fullnodeUrl?: string;
  packageId?: string;
  adminSecretKey?: string;
  didAddressMapJson?: string;
  keySource: "env" | "relay_kms" | "relay_hsm" | "vault" | "external_signer";
  allowEnvSecretInDeploy: boolean;
}

export interface ResolvedAuthConfig {
  mode: "dev_headers" | "oidc_jwt";
  oidc: {
    issuer?: string;
    audience?: string;
    jwksUrl?: string;
    tenantClaim: string;
  };
  devDefaultTenant: string;
  devDefaultRoles: string[];
}

export interface ResolvedMonitoringConfig {
  enabled: boolean;
  intervalMs: number;
  alertWebhookUrl?: string;
  thresholds: {
    outboxMaxLagSeconds: number;
    retryingJobs: number;
    reconMismatches24h: number;
    reconFailures1h: number;
  };
  alertCooldownMs: number;
}

export interface ResolvedAuditConfig {
  wormArchiveUrl?: string;
  wormRequiredInDeploy: boolean;
}

export interface ResolvedAppConfig {
  runtime: "development" | "deploy";
  host: string;
  port: number;
  outboxWorkerEnabled: boolean;
  outboxWorkerIntervalMs: number;
  reconciliationEnabled: boolean;
  reconciliationIntervalMs: number;
  monitoring: ResolvedMonitoringConfig;
  auth: ResolvedAuthConfig;
  audit: ResolvedAuditConfig;
  adminCompensationRequireApproval: boolean;
  iota: ResolvedIotaConfig;
}

let cachedEnv: ParsedApiEnv | null = null;
let dotenvLoaded = false;

export function loadApiEnvFile(): void {
  if (dotenvLoaded) return;
  const explicitPath = process.env.DOTENV_PATH;
  loadDotenv({
    path: explicitPath,
    override: false, // shell env must win over file values (e.g. PORT=3003 ...)
  });
  dotenvLoaded = true;
}

export function getRawApiEnv(): ParsedApiEnv {
  loadApiEnvFile();
  if (cachedEnv) return cachedEnv;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new AppError("Invalid environment configuration", 500, parsed.error.flatten());
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

function truthy(value?: string): boolean {
  return value === "1" || value === "true";
}

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function pickNetworkValue(
  env: ParsedApiEnv,
  key: "TX_RELAY_URL" | "NOTARIZATION_RELAY_URL" | "FULLNODE_URL" | "PACKAGE_ID" | "RELAY_API_KEY",
): string | undefined {
  const network = env.IOTA_NETWORK.toUpperCase();
  const specificKey = `IOTA_${network}_${key}` as keyof ParsedApiEnv;
  const genericKey = `IOTA_${key}` as keyof ParsedApiEnv;
  const specific = env[specificKey];
  const generic = env[genericKey];
  return (typeof specific === "string" && specific) || (typeof generic === "string" && generic) || undefined;
}

export function getResolvedAppConfig(): ResolvedAppConfig {
  const env = getRawApiEnv();
  const runtime = env.APP_RUNTIME;
  const authMode = env.AUTH_MODE;
  const iotaMode = env.IOTA_MODE;
  const iotaKeySource = env.IOTA_KEY_SOURCE;
  const allowEnvSecretInDeploy = truthy(env.IOTA_ALLOW_ENV_SECRET_IN_DEPLOY);

  if (authMode === "oidc_jwt" && !env.AUTH_OIDC_JWKS_URL) {
    throw new AppError("AUTH_OIDC_JWKS_URL is required when AUTH_MODE=oidc_jwt", 500);
  }

  if (
    runtime === "deploy" &&
    iotaMode === "sdk" &&
    env.IOTA_ADMIN_SECRET_KEY &&
    iotaKeySource === "env" &&
    !allowEnvSecretInDeploy
  ) {
    throw new AppError(
      "Production policy forbids IOTA_ADMIN_SECRET_KEY in env when using direct SDK signing. Use relay_kms/relay_hsm (recommended) or set IOTA_ALLOW_ENV_SECRET_IN_DEPLOY=true only as a temporary exception.",
      500,
    );
  }

  if (
    runtime === "deploy" &&
    truthy(env.AUDIT_WORM_REQUIRED_IN_DEPLOY) &&
    !env.AUDIT_WORM_ARCHIVE_URL
  ) {
    throw new AppError(
      "AUDIT_WORM_ARCHIVE_URL is required in deploy when AUDIT_WORM_REQUIRED_IN_DEPLOY=true",
      500,
    );
  }

  return {
    runtime,
    host: env.HOST,
    port: env.PORT,
    outboxWorkerEnabled: truthy(env.OUTBOX_WORKER_ENABLED),
    outboxWorkerIntervalMs: env.OUTBOX_WORKER_INTERVAL_MS,
    reconciliationEnabled: truthy(env.RECONCILIATION_ENABLED),
    reconciliationIntervalMs: env.RECONCILIATION_INTERVAL_MS,
    monitoring: {
      enabled: truthy(env.MONITORING_ENABLED),
      intervalMs: env.MONITORING_INTERVAL_MS,
      alertWebhookUrl: env.ALERT_WEBHOOK_URL,
      thresholds: {
        outboxMaxLagSeconds: env.ALERT_OUTBOX_MAX_LAG_SECONDS,
        retryingJobs: env.ALERT_OUTBOX_RETRYING_JOBS,
        reconMismatches24h: env.ALERT_RECON_MISMATCHES_24H,
        reconFailures1h: env.ALERT_RECON_FAILURES_1H,
      },
      alertCooldownMs: env.ALERT_COOLDOWN_MS,
    },
    auth: {
      mode: authMode,
      oidc: {
        issuer: env.AUTH_OIDC_ISSUER,
        audience: env.AUTH_OIDC_AUDIENCE,
        jwksUrl: env.AUTH_OIDC_JWKS_URL,
        tenantClaim: env.AUTH_TENANT_CLAIM,
      },
      devDefaultTenant: env.AUTH_DEV_DEFAULT_TENANT,
      devDefaultRoles: csv(env.AUTH_DEV_DEFAULT_ROLES),
    },
    audit: {
      wormArchiveUrl: env.AUDIT_WORM_ARCHIVE_URL,
      wormRequiredInDeploy: truthy(env.AUDIT_WORM_REQUIRED_IN_DEPLOY),
    },
    adminCompensationRequireApproval: truthy(env.ADMIN_COMPENSATION_REQUIRE_APPROVAL),
    iota: {
      network: env.IOTA_NETWORK,
      mode: env.IOTA_MODE,
      allowStubs: truthy(env.IOTA_ALLOW_STUBS),
      disableNotarizationSdk: truthy(env.IOTA_NOTARIZATION_DISABLE_SDK),
      txRelayUrl: pickNetworkValue(env, "TX_RELAY_URL"),
      notarizationRelayUrl: pickNetworkValue(env, "NOTARIZATION_RELAY_URL"),
      relayApiKey: pickNetworkValue(env, "RELAY_API_KEY"),
      fullnodeUrl: pickNetworkValue(env, "FULLNODE_URL"),
      packageId: pickNetworkValue(env, "PACKAGE_ID"),
      adminSecretKey: env.IOTA_ADMIN_SECRET_KEY,
      didAddressMapJson: env.IOTA_DID_ADDRESS_MAP_JSON,
      keySource: iotaKeySource,
      allowEnvSecretInDeploy,
    },
  };
}
