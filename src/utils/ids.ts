import type { RequestId } from "../types/common.js";

let nextLocalId = 1;

export function createLocalRequestId(prefix = "actionReq"): string {
  const id = `${prefix}-${nextLocalId}`;
  nextLocalId += 1;
  return id;
}

let numericSeq = 0;

export function createNumericRequestId(seed?: number): RequestId {
  if (seed != null) return seed;
  numericSeq = (numericSeq + 1) % 1000;
  return (Date.now() % 1_000_000) * 1000 + numericSeq;
}

export function assertFiniteNumber(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number for ${name}, got ${String(value)}`);
  }
  return value;
}
