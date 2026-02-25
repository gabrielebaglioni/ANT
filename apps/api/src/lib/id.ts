import { randomBytes, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function newShipmentCode(): string {
  return `ANT-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export function fakeIotaObjectId(): string {
  return `0x${randomBytes(16).toString("hex")}`;
}
