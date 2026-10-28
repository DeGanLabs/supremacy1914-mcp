import type { CommandQueue } from "./command-queue.js";
import type { CabinetMemory } from "./memory.js";
import type { CabinetPlan, PlanTask } from "./types.js";
import type { WarArmyRow, WarWatchSnapshot } from "./war-types.js";
import { isPhase1Executable } from "./types.js";

export interface ReconcileResult {
  readonly stalePlanIds: readonly string[];
  readonly cancelledCommands: number;
  readonly hints: readonly string[];
  readonly brief: string;
}

function armyNearTarget(
  army: WarArmyRow | undefined,
  x: number,
  y: number,
  threshold = 25,
): boolean {
  if (!army?.pos) return false;
  return Math.hypot(army.pos.x - x, army.pos.y - y) <= threshold;
}

function taskStaleReason(
  task: PlanTask,
  ownById: Map<number, WarArmyRow>,
): string | null {
  if (!isPhase1Executable(task.type) || task.proposeOnly) return null;
  const args = task.args ?? {};

  if (task.type === "moveArmy") {
    const armyId = Number(args.armyId);
    if (!Number.isFinite(armyId)) return null;
    const army = ownById.get(armyId);
    if (!army) return `moveArmy ${armyId}: army gone from map`;
    const x = Number(args.x);
    const y = Number(args.y);
    if (Number.isFinite(x) && Number.isFinite(y) && armyNearTarget(army, x, y)) {
      return `moveArmy ${armyId}: already at/near target`;
    }
    return null;
  }

  if (task.type === "attackArmy") {
    const armyId = Number(args.armyId);
    const targetId = Number(args.targetArmyId);
    if (!Number.isFinite(armyId)) return null;
    if (!ownById.has(armyId)) return `attackArmy ${armyId}: army gone`;
    // Target may be foreign — can't always verify; only check own stack exists.
    if (!Number.isFinite(targetId)) return `attackArmy ${armyId}: bad target id`;
    return null;
  }

  if (task.type === "delayArmy") {
    const armyId = Number(args.armyId);
    if (!Number.isFinite(armyId)) return null;
    if (!ownById.has(armyId)) return `delayArmy ${armyId}: army gone`;
    return null;
  }

  return null;
}

/**
 * Mark proposed/approved plans whose Phase-1 tasks no longer match the map,
 * and cancel queued commands for missing armies.
 */
export async function reconcilePlansWithMap(
  memory: CabinetMemory,
  snap: WarWatchSnapshot,
  queue: CommandQueue,
): Promise<ReconcileResult> {
  const ownById = new Map(
    (snap.picture.ownArmies ?? []).map((a) => [a.id, a] as const),
  );
  const hints: string[] = [];
  const stalePlanIds: string[] = [];

  const plans = await memory.getPlans();
  for (const plan of plans) {
    if (plan.status !== "proposed" && plan.status !== "approved") continue;
    const staleTasks: string[] = [];
    for (const task of plan.tasks) {
      const reason = taskStaleReason(task, ownById);
      if (reason) staleTasks.push(reason);
    }
    if (!staleTasks.length) continue;

    const allExec = plan.tasks.filter(
      (t) => isPhase1Executable(t.type) && !t.proposeOnly,
    );
    const allStale =
      allExec.length > 0 &&
      allExec.every((t) => taskStaleReason(t, ownById) != null);

    if (allStale && plan.status === "proposed") {
      const next: CabinetPlan = {
        ...plan,
        status: "rejected",
        goalSummary: `${plan.goalSummary} [stale vs map @ ${snap.takenAt}]`,
      };
      await memory.savePlan(next);
      stalePlanIds.push(plan.id);
      hints.push(
        `PLAN ${plan.id} obsolete vs map — ${staleTasks.slice(0, 2).join("; ")}. Ask staff to replan.`,
      );
    } else {
      hints.push(
        `PLAN ${plan.id} partially stale: ${staleTasks.slice(0, 3).join("; ")}`,
      );
    }
  }

  let cancelledCommands = 0;
  for (const cmd of queue.list(80)) {
    if (
      cmd.status !== "queued" &&
      cmd.status !== "waiting" &&
      cmd.status !== "failed"
    ) {
      continue;
    }
    if (cmd.army == null) continue;
    if (ownById.has(cmd.army)) continue;
    await queue.mark(cmd.command_id, {
      status: "cancelled",
      detail: `army ${cmd.army} missing from war picture`,
    });
    cancelledCommands += 1;
    hints.push(`cancelled queue ${cmd.command_id} — army ${cmd.army} gone`);
  }

  const brief = hints.length
    ? ["Plan/map reconcile:", ...hints.slice(0, 6).map((h) => `  - ${h}`)].join(
        "\n",
      )
    : "";

  return { stalePlanIds, cancelledCommands, hints, brief };
}
