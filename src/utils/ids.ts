import type { RequestId } from "../types/common.js";

let nextLocalId = 1;

export function createLocalRequestId(prefix = "actionReq"): string {
  const id = `${prefix}-${nextLocalId}`;
  nextLocalId += 1;
  return id;
}

export function createNumericRequestId(seed?: number): RequestId {
  return seed ?? Date.now() % 1_000_000;
}

export function assertFiniteNumber(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number for ${name}, got ${String(value)}`);
  }
  return value;
}
