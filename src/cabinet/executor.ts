import type { BrowserBridgeServer } from "../sensor/bridge-client.js";
import { classifyTasks } from "./policy.js";
import type { CabinetPlan, PlanTask } from "./types.js";
import type { CabinetMemory } from "./memory.js";

export interface ExecuteResult {
  readonly ok: boolean;
  readonly results: { type: string; ok: boolean; detail: string }[];
  readonly skippedProposeOnly: number;
}

export class CabinetExecutor {
  constructor(
    private readonly bridge: BrowserBridgeServer,
    private readonly memory: CabinetMemory,
    private readonly quietTelegram: boolean,
  ) {}

  async executeApproved(
    plan: CabinetPlan,
    onlyTasks?: readonly PlanTask[],
  ): Promise<ExecuteResult> {
    const idem = `approve:${plan.id}:${plan.payloadHash}`;
    if (this.bridge.wasDone(idem)) {
      return {
        ok: true,
        results: [{ type: "_idempotent", ok: true, detail: "already executed" }],
        skippedProposeOnly: 0,
      };
    }

    if (!this.bridge.isHealthy()) {
      throw new Error("game not connected");
    }

    const { executable, proposeOnly } = classifyTasks(
      onlyTasks?.length ? onlyTasks : plan.tasks,
    );
    if (executable.length === 0) {
      throw new Error(
        "approve refused — no Phase-1 executable tasks (moveArmy/constructBuilding/attackArmy/delayArmy); plan is propose-only/advisory",
      );
    }
    const results: ExecuteResult["results"] = [];

    const sleep = (ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms));

    for (let i = 0; i < executable.length; i++) {
      const task = executable[i]!;
      const taskIdem = `${idem}:${task.type}:${JSON.stringify(task.args)}`;
      if (this.bridge.wasDone(taskIdem)) {
        results.push({ type: task.type, ok: true, detail: "skip duplicate" });
        continue;
      }
      try {
        // Space moves so the game pending-queue doesn't drop/overwrite selection.
        if (i > 0 && task.type === "moveArmy") {
          await sleep(450);
        }
        let result: unknown;
        if (task.type === "moveArmy") {
          result = await this.bridge.call("moveArmy", {
            armyId: task.args.armyId,
            x: task.args.x,
            y: task.args.y,
            append: !!(task.args as { append?: boolean }).append,
          });
        } else if (task.type === "constructBuilding") {
          let provinceIdOrName = task.args.provinceIdOrName;
          let upgradeId = Number(task.args.upgradeId);
          const upgradeName = String(
            (task.args as { upgradeName?: string }).upgradeName ?? "",
          ).trim();
          try {
            const listed = (await this.bridge.call("list_province_upgrades", {
              provinceIdOrName,
            })) as {
              upgrades?: Array<{ upgradeId: number; name?: string }>;
            };
            const ups = listed.upgrades ?? [];
            const exactId = ups.find((u) => u.upgradeId === upgradeId);
            if (!exactId) {
              const needle = upgradeName.toLowerCase();
              const exactName = needle
                ? ups.find((u) => (u.name ?? "").toLowerCase() === needle)
                : undefined;
              const uniqueName =
                !exactName && needle
                  ? ups.filter((u) =>
                      (u.name ?? "").toLowerCase().includes(needle),
                    )
                  : [];
              if (exactName) upgradeId = exactName.upgradeId;
              else if (uniqueName.length === 1) upgradeId = uniqueName[0]!.upgradeId;
            }
            if (!ups.some((u) => u.upgradeId === upgradeId)) {
              throw new Error(
                `upgradeId ${upgradeId} not at ${provinceIdOrName} — available: ${ups
                  .slice(0, 15)
                  .map((u) => `${u.upgradeId}=${u.name}`)
                  .join(", ")}`,
              );
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes("available:")) throw e;
            if (!Number.isFinite(upgradeId) || upgradeId <= 0) throw e;
          }
          result = await this.bridge.call("constructBuilding", {
            provinceIdOrName,
            upgradeId,
          });
        } else if (task.type === "attackArmy") {
          result = await this.bridge.call("attackArmy", {
            armyId: task.args.armyId,
            targetArmyId: task.args.targetArmyId,
          });
        } else if (task.type === "delayArmy") {
          result = await this.bridge.call("delayArmy", {
            armyId: task.args.armyId,
            minutes: task.args.minutes,
            syncArrival: task.args.syncArrival ?? false,
          });
        } else {
          results.push({
            type: task.type,
            ok: false,
            detail: "not on Phase-1 allow-list",
          });
          continue;
        }
        const asObj =
          typeof result === "object" && result !== null
            ? (result as Record<string, unknown>)
            : null;
        const verifiedOk =
          asObj == null ||
          (asObj.verified !== false && asObj.ok !== false);
        if (!verifiedOk) {
          results.push({
            type: task.type,
            ok: false,
            detail: formatBridgeResult(asObj!),
          });
          continue;
        }
        this.bridge.markDone(taskIdem);
        const detail = asObj
          ? formatBridgeResult(asObj)
          : this.quietTelegram
            ? "queued"
            : JSON.stringify(task.args);
        results.push({
          type: task.type,
          ok: true,
          detail,
        });
      } catch (err) {
        results.push({
          type: task.type,
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const allOk = results.every((r) => r.ok);
    // Only mark plan-level idempotent on full success — failed plans must be retryable.
    if (allOk) this.bridge.markDone(idem);
    plan.status = allOk ? "done" : "failed";
    await this.memory.savePlan(plan);
    return {
      ok: allOk,
      results,
      skippedProposeOnly: proposeOnly.length,
    };
  }
}

function formatBridgeResult(r: Record<string, unknown>): string {
  if (r.verified === false || r.ok === false) {
    return String(r.error ?? r.detail ?? "unverified move");
  }
  const armyHint =
    r.armyId != null
      ? `Army ${r.armyId}`
      : Array.isArray(r.armyIds)
        ? `Armies ${(r.armyIds as number[]).slice(0, 4).join(",")}`
        : null;
  const dest = r.destinationProvince
    ? String(r.destinationProvince)
    : r.target && typeof r.target === "object"
      ? `(${Math.round(Number((r.target as { x?: number }).x))},${Math.round(Number((r.target as { y?: number }).y))})`
      : null;
  if (dest) {
    const sea = r.onSea ? "water off " : "";
    const who = armyHint ? `${armyHint} → ` : "→ ";
    return `${who}${sea}${dest}`.replace(/\s+/g, " ").trim();
  }
  if (r.name) return String(r.name);
  if (r.mode === "multi" && Array.isArray(r.armyIds)) {
    return `multi ${r.verifiedCount ?? r.armyIds.length}/${r.armyIds.length} verified`;
  }
  return JSON.stringify(r).slice(0, 120);
}
