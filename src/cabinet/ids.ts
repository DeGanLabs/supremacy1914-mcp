import { createHash } from "node:crypto";
import type { PlanTask } from "./types.js";
import { isPhase1Executable } from "./types.js";

export function hashPlanPayload(tasks: readonly PlanTask[]): string {
  const normalized = tasks.map((t) => ({
    type: t.type,
    args: t.args,
    risk: t.risk,
    proposeOnly: t.proposeOnly ?? !isPhase1Executable(t.type),
  }));
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16);
}

export function createPlanId(): string {
  return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
