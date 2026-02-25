import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { getResolvedAppConfig, type ResolvedIotaConfig } from "../../config/env";
import { AppError } from "../../lib/errors";

export interface CreateShipmentOnChainInput {
  shipmentCode: string;
  initialCustodianDid: string;
}

export interface LockedNotarizationResult {
  notarizationObjectId: string;
  txDigest: string;
  anchoredAt: string;
}

export interface MoveTxResult {
  txDigest: string | null;
}

export interface ChainShipmentSnapshot {
  moveObjectId: string;
  status: string | null;
  currentCustodianAddress: string | null;
  expectedReceiverAddress: string | null;
  seq: number | null;
  lastNotarizationId: string | null;
  lastEventHashHex: string | null;
}

type Json = Record<string, unknown>;

function hexToBytes(hex: string): number[] {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new AppError("Invalid hex length", 400);
  }
  return Array.from(Buffer.from(normalized, "hex"));
}

function utf8Bytes(s: string): number[] {
  return Array.from(Buffer.from(s, "utf8"));
}

function sha256Bytes(hexHash: string): number[] {
  return hexToBytes(hexHash);
}

function parseDidMap(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed;
  } catch (error) {
    throw new AppError(
      `Invalid IOTA_DID_ADDRESS_MAP_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      500,
    );
  }
}

@Injectable()
export class IotaGateway {
  private readonly logger = new Logger(IotaGateway.name);
  private readonly cfg: ResolvedIotaConfig = getResolvedAppConfig().iota;
  private readonly didMap = parseDidMap(this.cfg.didAddressMapJson);

  constructor() {
    if (
      this.cfg.mode === "sdk" &&
      this.cfg.keySource !== "env" &&
      !this.cfg.txRelayUrl
    ) {
      this.logger.warn(
        `IOTA keySource=${this.cfg.keySource} selected but direct SDK signing only supports env secret in this MVP. Configure relay-backed signing (recommended for KMS/HSM).`,
      );
    }
  }

  async createShipmentObject(
    input: CreateShipmentOnChainInput,
  ): Promise<{ moveObjectId: string; moveVersion: number; txDigest: string | null }> {
    if (this.cfg.txRelayUrl) {
      const result = await this.callRelay(this.cfg.txRelayUrl, "createShipmentObject", input);
      return {
        moveObjectId: String(result.moveObjectId),
        moveVersion: Number(result.moveVersion ?? 1),
        txDigest: (result.txDigest as string | undefined) ?? null,
      };
    }

    if (this.canUseSdk()) {
      return this.createShipmentObjectViaSdk(input);
    }

    return this.stubIfAllowed<{ moveObjectId: string; moveVersion: number; txDigest: string | null }>({
      moveObjectId: `0x${randomBytes(16).toString("hex")}`,
      moveVersion: 1,
      txDigest: createHash("sha256")
        .update(`moveCreate:${input.shipmentCode}:${Date.now()}`)
        .digest("hex"),
    });
  }

  async createLockedNotarization(payloadHash: string): Promise<LockedNotarizationResult> {
    if (this.cfg.notarizationRelayUrl) {
      const result = await this.callRelay(
        this.cfg.notarizationRelayUrl,
        "createLockedNotarization",
        { payloadHash },
      );
      return {
        notarizationObjectId: String(result.notarizationObjectId),
        txDigest: String(result.txDigest),
        anchoredAt: String(result.anchoredAt ?? new Date().toISOString()),
      };
    }

    if (this.canUseNotarizationSdk()) {
      return this.createLockedNotarizationViaSdk(payloadHash);
    }

    return this.stubIfAllowed<LockedNotarizationResult>({
      notarizationObjectId: `0x${randomBytes(16).toString("hex")}`,
      txDigest: createHash("sha256")
        .update(`${payloadHash}:${randomBytes(8).toString("hex")}`)
        .digest("hex"),
      anchoredAt: new Date().toISOString(),
    });
  }

  async handoverOut(input: {
    moveObjectId: string;
    shipmentCode: string;
    receiverDid: string;
    payloadHash: string;
    notarizationObjectId: string;
  }): Promise<MoveTxResult> {
    if (this.cfg.txRelayUrl) {
      const result = await this.callRelay(this.cfg.txRelayUrl, "handoverOut", input);
      return { txDigest: (result.txDigest as string | undefined) ?? null };
    }
    if (this.canUseSdk()) {
      const result = await this.callMoveEntry("handover_out", {
        shipmentObjectId: input.moveObjectId,
        shipmentCode: input.shipmentCode,
        receiverAddress: this.didToAddress(input.receiverDid),
        payloadHash: input.payloadHash,
        notarizationObjectId: input.notarizationObjectId,
      });
      return { txDigest: (result.txDigest as string | undefined) ?? null };
    }
    return this.stubIfAllowed<MoveTxResult>({
      txDigest: createHash("sha256")
        .update(`handoverOut:${input.moveObjectId}:${Date.now()}`)
        .digest("hex"),
    });
  }

  async handoverInConfirm(input: {
    moveObjectId: string;
    shipmentCode: string;
    payloadHash: string;
    notarizationObjectId: string;
  }): Promise<MoveTxResult> {
    if (this.cfg.txRelayUrl) {
      const result = await this.callRelay(this.cfg.txRelayUrl, "handoverInConfirm", input);
      return { txDigest: (result.txDigest as string | undefined) ?? null };
    }
    if (this.canUseSdk()) {
      const result = await this.callMoveEntry("handover_in_confirm", {
        shipmentObjectId: input.moveObjectId,
        shipmentCode: input.shipmentCode,
        payloadHash: input.payloadHash,
        notarizationObjectId: input.notarizationObjectId,
      });
      return { txDigest: (result.txDigest as string | undefined) ?? null };
    }
    return this.stubIfAllowed<MoveTxResult>({
      txDigest: createHash("sha256")
        .update(`handoverIn:${input.moveObjectId}:${Date.now()}`)
        .digest("hex"),
    });
  }

  async getShipmentSnapshot(moveObjectId: string): Promise<ChainShipmentSnapshot | null> {
    if (!moveObjectId) return null;
    if (this.cfg.txRelayUrl) {
      const result = await this.callRelay(this.cfg.txRelayUrl, "getShipmentSnapshot", {
        moveObjectId,
      });
      return {
        moveObjectId,
        status: (result.status as string | undefined) ?? null,
        currentCustodianAddress:
          (result.currentCustodianAddress as string | undefined) ?? null,
        expectedReceiverAddress:
          (result.expectedReceiverAddress as string | undefined) ?? null,
        seq:
          result.seq === undefined || result.seq === null
            ? null
            : Number(result.seq),
        lastNotarizationId: (result.lastNotarizationId as string | undefined) ?? null,
        lastEventHashHex: (result.lastEventHashHex as string | undefined) ?? null,
      };
    }
    if (this.canUseSdk()) {
      // SDK object read support varies by version. Prefer relay in production for stable behavior.
      return this.stubIfAllowed<ChainShipmentSnapshot>({
        moveObjectId,
        status: null,
        currentCustodianAddress: null,
        expectedReceiverAddress: null,
        seq: null,
        lastNotarizationId: null,
        lastEventHashHex: null,
      });
    }
    return this.stubIfAllowed<ChainShipmentSnapshot>({
      moveObjectId,
      status: null,
      currentCustodianAddress: null,
      expectedReceiverAddress: null,
      seq: null,
      lastNotarizationId: null,
      lastEventHashHex: null,
    });
  }

  async adminOpenDispute(input: { moveObjectId: string; reason: string }): Promise<MoveTxResult> {
    return this.callAdminAction("openDispute", input);
  }

  async adminSuspend(input: { moveObjectId: string; reason: string }): Promise<MoveTxResult> {
    return this.callAdminAction("suspend", input);
  }

  async adminCorrectiveHandover(input: {
    moveObjectId: string;
    receiverDid: string;
    payloadHash: string;
    notarizationObjectId: string;
  }): Promise<MoveTxResult> {
    return this.callAdminAction("correctiveHandover", input);
  }

  private didToAddress(did: string): string {
    const mapped = this.didMap[did];
    if (!mapped) {
      throw new AppError(
        `No IOTA address mapping found for DID ${did}. Set IOTA_DID_ADDRESS_MAP_JSON.`,
        500,
      );
    }
    return mapped;
  }

  tryResolveDidAddress(did: string | null | undefined): string | null {
    if (!did) return null;
    return this.didMap[did] ?? null;
  }

  private canUseSdk(): boolean {
    if (this.cfg.keySource !== "env") return false;
    return Boolean(this.cfg.fullnodeUrl && this.cfg.packageId && this.cfg.adminSecretKey);
  }

  private canUseNotarizationSdk(): boolean {
    return Boolean(this.canUseSdk() && !this.cfg.disableNotarizationSdk);
  }

  private async createShipmentObjectViaSdk(
    input: CreateShipmentOnChainInput,
  ): Promise<{ moveObjectId: string; moveVersion: number; txDigest: string | null }> {
    const result = await this.callMoveEntry("new_shipment_and_share", {
      shipmentCode: input.shipmentCode,
      initialCustodianAddress: this.didToAddress(input.initialCustodianDid),
    });
    return {
      moveObjectId: String(result.moveObjectId),
      moveVersion: Number(result.moveVersion ?? 1),
      txDigest: (result.txDigest as string | undefined) ?? null,
    };
  }

  private async callMoveEntry(
    functionName: "new_shipment_and_share" | "handover_out" | "handover_in_confirm",
    params: {
      shipmentObjectId?: string;
      shipmentCode?: string;
      initialCustodianAddress?: string;
      receiverAddress?: string;
      payloadHash?: string;
      notarizationObjectId?: string;
    },
  ): Promise<Json> {
    const fullnodeUrl = this.cfg.fullnodeUrl;
    const packageId = this.cfg.packageId;
    const secret = this.cfg.adminSecretKey;
    if (this.cfg.keySource !== "env") {
      throw new AppError(
        `Direct SDK signing with keySource=${this.cfg.keySource} is disabled in this MVP. Use relay-backed signing (relay_kms/relay_hsm) for production.`,
        503,
      );
    }
    if (!fullnodeUrl || !packageId || !secret) {
      throw new AppError("IOTA SDK config missing", 500);
    }

    const mod = (await import("@iota/iota-sdk")) as any;
    const clientCtor = mod.IotaClient ?? mod.Client;
    const txCtor = mod.Transaction ?? mod.TransactionBlock;
    const keypairCtor = mod.Ed25519Keypair ?? mod.Keypair?.Ed25519Keypair;
    if (!clientCtor || !txCtor || !keypairCtor) {
      throw new AppError(
        "Unsupported @iota/iota-sdk exports. Configure IOTA_TX_RELAY_URL as fallback.",
        500,
      );
    }

    const client = new clientCtor({ url: fullnodeUrl });
    const tx = new txCtor();
    const targetBase = `${packageId}::shipment`;

    const nowMs = BigInt(Date.now());

    if (functionName === "new_shipment_and_share") {
      const codeBytes = utf8Bytes(params.shipmentCode ?? "");
      const initialAddr = params.initialCustodianAddress;
      if (!initialAddr) throw new AppError("Missing initialCustodianAddress", 500);

      const newShipmentResult =
        tx.moveCall?.({
          target: `${targetBase}::new_shipment`,
          arguments: [
            this.txPure(tx, codeBytes, "vector<u8>"),
            this.txPure(tx, initialAddr, "address"),
          ],
        }) ??
        tx.moveCall?.(`${targetBase}::new_shipment`, [], [
          this.txPure(tx, codeBytes, "vector<u8>"),
          this.txPure(tx, initialAddr, "address"),
        ]);

      tx.moveCall?.({
        target: `${targetBase}::share`,
        arguments: Array.isArray(newShipmentResult) ? [newShipmentResult[0]] : [newShipmentResult],
      }) ??
        tx.moveCall?.(`${targetBase}::share`, [], [
          Array.isArray(newShipmentResult) ? newShipmentResult[0] : newShipmentResult,
        ]);
    } else if (functionName === "handover_out") {
      tx.moveCall?.({
        target: `${targetBase}::handover_out`,
        arguments: [
          tx.object?.(params.shipmentObjectId),
          this.txPure(tx, params.receiverAddress, "address"),
          this.txPure(tx, sha256Bytes(params.payloadHash ?? ""), "vector<u8>"),
          this.txPure(tx, utf8Bytes(params.notarizationObjectId ?? ""), "vector<u8>"),
          this.txPure(tx, nowMs, "u64"),
        ],
      }) ??
        tx.moveCall?.(`${targetBase}::handover_out`, [], [
          tx.object?.(params.shipmentObjectId),
          this.txPure(tx, params.receiverAddress, "address"),
          this.txPure(tx, sha256Bytes(params.payloadHash ?? ""), "vector<u8>"),
          this.txPure(tx, utf8Bytes(params.notarizationObjectId ?? ""), "vector<u8>"),
          this.txPure(tx, nowMs, "u64"),
        ]);
    } else if (functionName === "handover_in_confirm") {
      tx.moveCall?.({
        target: `${targetBase}::handover_in_confirm`,
        arguments: [
          tx.object?.(params.shipmentObjectId),
          this.txPure(tx, sha256Bytes(params.payloadHash ?? ""), "vector<u8>"),
          this.txPure(tx, utf8Bytes(params.notarizationObjectId ?? ""), "vector<u8>"),
          this.txPure(tx, nowMs, "u64"),
        ],
      }) ??
        tx.moveCall?.(`${targetBase}::handover_in_confirm`, [], [
          tx.object?.(params.shipmentObjectId),
          this.txPure(tx, sha256Bytes(params.payloadHash ?? ""), "vector<u8>"),
          this.txPure(tx, utf8Bytes(params.notarizationObjectId ?? ""), "vector<u8>"),
          this.txPure(tx, nowMs, "u64"),
        ]);
    }

    const signer = this.createKeypairFromSecret(keypairCtor, secret);
    const signAndExecute =
      client.signAndExecuteTransaction ??
      client.signAndExecuteTransactionBlock ??
      client.executeTransactionBlock;

    if (!signAndExecute) {
      throw new AppError(
        "Unsupported IOTA client execute method. Configure IOTA_TX_RELAY_URL as fallback.",
        500,
      );
    }

    const result = await signAndExecute.call(client, {
      signer,
      transaction: tx,
      transactionBlock: tx,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    });

    const objectChanges = (result as any)?.objectChanges as any[] | undefined;
    const createdOrPublished = objectChanges?.find(
      (c) => c?.objectType?.includes?.("::shipment::Shipment") || c?.type === "created",
    );

    return {
      txDigest:
        (result as any)?.digest ??
        (result as any)?.effects?.transactionDigest ??
        `0x${randomBytes(16).toString("hex")}`,
      moveObjectId:
        createdOrPublished?.objectId ??
        createdOrPublished?.id ??
        params.shipmentObjectId ??
        null,
      moveVersion:
        Number(createdOrPublished?.version ?? createdOrPublished?.objectVersion ?? 1) || 1,
      raw: result,
    };
  }

  private txPure(tx: any, value: unknown, typeHint?: string): any {
    if (tx.pure?.u64 && typeHint === "u64" && typeof value === "bigint") {
      return tx.pure.u64(value);
    }
    if (typeof tx.pure === "function") {
      try {
        return typeHint ? tx.pure(value, typeHint) : tx.pure(value);
      } catch {
        return tx.pure(value);
      }
    }
    if (tx.pure && typeof tx.pure === "object") {
      if (typeHint === "address" && tx.pure.address) return tx.pure.address(value);
      if (typeHint === "u64" && tx.pure.u64) return tx.pure.u64(value);
      if (tx.pure.vector && Array.isArray(value)) return tx.pure.vector("u8", value);
    }
    return value;
  }

  private createKeypairFromSecret(keypairCtor: any, secret: string): any {
    if (keypairCtor.fromSecretKey) {
      const bytes =
        secret.startsWith("0x") || /^[a-f0-9]+$/i.test(secret)
          ? Buffer.from(secret.replace(/^0x/, ""), "hex")
          : secret;
      return keypairCtor.fromSecretKey(bytes);
    }
    if (keypairCtor.fromSeed) {
      const bytes = Buffer.from(secret.replace(/^0x/, ""), "hex");
      return keypairCtor.fromSeed(bytes);
    }
    return new keypairCtor(secret);
  }

  private async createLockedNotarizationViaSdk(payloadHash: string): Promise<LockedNotarizationResult> {
    const mod = (await import("@iota/notarization")) as any;

    if (typeof mod.createLockedNotarization === "function") {
      const result = await mod.createLockedNotarization({
        hash: payloadHash,
        fullnodeUrl: this.cfg.fullnodeUrl,
        secretKey: this.cfg.adminSecretKey,
      });
      return {
        notarizationObjectId: String(result.notarizationObjectId ?? result.objectId),
        txDigest: String(result.txDigest ?? result.digest),
        anchoredAt: String(result.anchoredAt ?? new Date().toISOString()),
      };
    }

    if (mod.NotarizationClient) {
      const client = new mod.NotarizationClient({
        fullnodeUrl: process.env.IOTA_FULLNODE_URL,
        secretKey: this.cfg.adminSecretKey,
      });
      const fn = client.createLockedNotarization ?? client.notarizeLocked;
      if (!fn) {
        throw new AppError(
          "Unsupported @iota/notarization client API. Configure IOTA_NOTARIZATION_RELAY_URL.",
          500,
        );
      }
      const result = await fn.call(client, { hash: payloadHash });
      return {
        notarizationObjectId: String(result.notarizationObjectId ?? result.objectId),
        txDigest: String(result.txDigest ?? result.digest),
        anchoredAt: String(result.anchoredAt ?? new Date().toISOString()),
      };
    }

    throw new AppError(
      "Unsupported @iota/notarization exports. Configure IOTA_NOTARIZATION_RELAY_URL.",
      500,
    );
  }

  private async callRelay(base: string | undefined, method: string, payload: unknown): Promise<Json> {
    if (!base) {
      throw new AppError("IOTA relay URL not configured", 500);
    }

    const url = `${base.replace(/\/$/, "")}/${method}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.cfg.relayApiKey
          ? { Authorization: `Bearer ${this.cfg.relayApiKey}` }
          : {}),
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) {
      throw new AppError(
        `IOTA relay error ${response.status}`,
        502,
        body,
      );
    }
    return body;
  }

  private async callAdminAction(method: string, payload: Record<string, unknown>): Promise<MoveTxResult> {
    if (this.cfg.txRelayUrl) {
      const result = await this.callRelay(this.cfg.txRelayUrl, method, payload);
      return { txDigest: (result.txDigest as string | undefined) ?? null };
    }
    if (this.canUseSdk()) {
      // Admin compensation entry points are relay-first in this MVP due SDK surface variability.
      throw new AppError(
        "Admin compensation actions require relay integration in this MVP. Configure IOTA_TX_RELAY_URL.",
        503,
      );
    }
    return this.stubIfAllowed<MoveTxResult>({
      txDigest: createHash("sha256")
        .update(`${method}:${JSON.stringify(payload)}:${Date.now()}`)
        .digest("hex"),
    });
  }

  private stubIfAllowed<T>(value: T): T {
    if (!this.cfg.allowStubs) {
      throw new AppError(
        `IOTA integration not configured for network=${this.cfg.network}. Configure relay or SDK env vars, or enable stubs with IOTA_ALLOW_STUBS=true for local development.`,
        503,
      );
    }
    this.logger.warn(`Using IOTA stub fallback (network=${this.cfg.network}) because IOTA_ALLOW_STUBS=true`);
    return value;
  }
}
