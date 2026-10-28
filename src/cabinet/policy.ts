import {
  isPhase1Executable,
  type CabinetPlan,
  type PlanTask,
} from "./types.js";
import { PlanTaskSchema } from "./types.js";
import { hashPlanPayload } from "./ids.js";

export interface PolicyResult {
  readonly executable: PlanTask[];
  readonly proposeOnly: PlanTask[];
  readonly rejected: { task: PlanTask; reason: string }[];
}

export function classifyTasks(tasks: readonly PlanTask[]): PolicyResult {
  const executable: PlanTask[] = [];
  const proposeOnly: PlanTask[] = [];
  const rejected: { task: PlanTask; reason: string }[] = [];

  for (const raw of tasks) {
    const parsed = PlanTaskSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ task: raw, reason: parsed.error.message });
      continue;
    }
    const task = parsed.data;
    if (task.proposeOnly || !isPhase1Executable(task.type)) {
      proposeOnly.push({
        ...task,
        proposeOnly: true,
      });
      continue;
    }
    executable.push(task);
  }
  return { executable, proposeOnly, rejected };
}

/** Recompute from current tasks. Optional `claimedHash` must also match. */
export function assertPlanHash(plan: CabinetPlan, claimedHash?: string): void {
  const expected = hashPlanPayload(plan.tasks);
  if (plan.payloadHash !== expected) {
    throw new Error("plan payload hash mismatch — refuse drifted approve");
  }
  if (claimedHash != null && claimedHash !== expected) {
    throw new Error("plan payload hash mismatch — refuse drifted approve");
  }
}
