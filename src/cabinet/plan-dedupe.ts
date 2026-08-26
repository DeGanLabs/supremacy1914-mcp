import { isPhase1Executable, type PlanTask } from "./types.js";

const MAX_EXECUTABLE = 12;

function taskDedupeKey(task: PlanTask): string {
  const args = (task.args ?? {}) as Record<string, unknown>;
  const type = String(task.type);
  if (type === "moveArmy") {
    // One move per army — later duplicate coords/names collapse.
    return `move:${args.armyId}`;
  }
  if (type === "delayArmy") {
    return `delay:${args.armyId}:${args.minutes}`;
  }
  if (type === "constructBuilding") {
    return `build:${String(args.provinceIdOrName).toLowerCase()}:${args.upgradeId}`;
  }
  if (type === "attackArmy") {
    return `atk:${args.armyId}:${args.targetArmyId}`;
  }
  return `${type}:${JSON.stringify(args)}`;
}

function isEmptyJunk(task: PlanTask): boolean {
  const type = String(task.type ?? "").toLowerCase();
  const args = (task.args ?? {}) as Record<string, unknown>;
  const keys = Object.keys(args).filter((k) => args[k] != null && args[k] !== "");
  if (
    type === "proposeonly" ||
    type === "propose" ||
    type === "spy_retask" ||
    type === "spyretask"
  ) {
    return keys.length === 0;
  }
  if (keys.length === 0 && !isPhase1Executable(task.type)) return true;
  if (type.includes("market") || type.includes("sell") || type.includes("buy")) {
    return true; // Phase-1 not supported — drop from plan
  }
  return false;
}

function spyHasTarget(task: PlanTask): boolean {
  const args = (task.args ?? {}) as Record<string, unknown>;
  const nation = args.targetNation ?? args.nationId ?? args.nation;
  const province = args.province ?? args.provinceIdOrName ?? args.targetProvince;
  const army = args.targetArmyId ?? args.armyId;
  const spyId = args.spyId ?? args.agentId;
  if (nation != null && String(nation).trim() && String(nation) !== "?") {
    return true;
  }
  if (province != null && String(province).trim() && String(province) !== "?") {
    return true;
  }
  if (army != null && Number(army) > 0) return true;
  if (spyId != null && Number(spyId) > 0 && args.mission != null) return true;
  const text = `${task.rationale ?? ""}`;
  if (/\b(new arkhangelsk|whitehorse|prince george|juneau|sitka)\b/i.test(text)) {
    return true;
  }
  return false;
}

/** Strip empty shells, incomplete spies, market stubs; dedupe; drop useless delays. */
export function cleanPlanTasks(tasks: readonly PlanTask[]): PlanTask[] {
  const filtered: PlanTask[] = [];
  for (const t of tasks) {
    if (isEmptyJunk(t)) continue;
    const type = String(t.type ?? "").toLowerCase();
    if (
      type.includes("spy") ||
      t.type === "spyMission" ||
      type === "spy_retask"
    ) {
      // This pass: spy never creates PLAN noise — drop spy tasks entirely.
      continue;
    }
    if (!isPhase1Executable(t.type) && t.proposeOnly !== false) {
      // Keep only Phase-1 for plans; drop other advisory types
      if (!spyHasTarget(t)) continue;
      continue;
    }
    filtered.push(t);
  }

  const seen = new Set<string>();
  const deduped: PlanTask[] = [];
  // Prefer later tasks (often have resolved coords) over earlier duplicates.
  for (const t of [...filtered].reverse()) {
    const key = taskDedupeKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.unshift(t);
  }

  const movedArmies = new Set<number>();
  for (const t of deduped) {
    if (t.type === "moveArmy") {
      const id = Number(((t.args ?? {}) as { armyId?: number }).armyId);
      if (Number.isFinite(id)) movedArmies.add(id);
    }
  }

  const delayed = new Set<number>();
  const collapsed: PlanTask[] = [];
  // One constructBuilding per province (keep last).
  const buildProv = new Set<string>();
  const collapsedBuilds: PlanTask[] = [];
  for (const t of [...deduped].reverse()) {
    if (t.type === "constructBuilding") {
      const prov = String(
        ((t.args ?? {}) as { provinceIdOrName?: unknown }).provinceIdOrName ?? "",
      )
        .toLowerCase()
        .trim();
      if (prov && buildProv.has(prov)) continue;
      if (prov) buildProv.add(prov);
      collapsedBuilds.unshift(t);
      continue;
    }
    collapsedBuilds.unshift(t);
  }
  for (const t of collapsedBuilds) {
    if (t.type === "delayArmy") {
      const id = Number(((t.args ?? {}) as { armyId?: number }).armyId);
      if (movedArmies.has(id)) continue;
      if (delayed.has(id)) continue;
      delayed.add(id);
    }
    collapsed.push(t);
  }

  const exec: PlanTask[] = [];
  const other: PlanTask[] = [];
  for (const t of collapsed) {
    if (isPhase1Executable(t.type) && !t.proposeOnly) exec.push(t);
    else other.push(t);
  }
  return [...exec.slice(0, MAX_EXECUTABLE), ...other];
}
