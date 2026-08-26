import type { CabinetPlan, PlanTask } from "./types.js";
import type { WarPictureRaw } from "./war-types.js";
import { formatArmyLabel, formatProvinceLabel } from "./army-labels.js";
import { provinceFromTaskText } from "./plan-normalize.js";
import { classifyTasks } from "./policy.js";

function humanTask(
  task: PlanTask,
  index: number,
  quiet: boolean,
  picture: WarPictureRaw | null | undefined,
): string {
  const n = index + 1;
  const tag = task.proposeOnly ? "advisory" : "will run";
  if (task.type === "moveArmy") {
    const a = (task.args ?? {}) as { armyId?: number; x?: number; y?: number };
    const label = formatArmyLabel(picture, a.armyId);
    const destName = provinceFromTaskText(task);
    const dest =
      destName ??
      (a.x != null && a.y != null
        ? formatProvinceLabel(picture, `${a.x},${a.y}`) !== "?"
          ? `(${a.x}, ${a.y})`
          : `(${a.x}, ${a.y})`
        : "?");
    const showId = quiet && !task.proposeOnly ? label.replace(/\s*\(\d+\)/, "") : label;
    return `${n}. ${tag} — Move ${showId} → ${dest}${task.template ? ` (${task.template})` : ""}`;
  }
  if (task.type === "spyMission") {
    const a = (task.args ?? {}) as {
      targetNation?: number;
      mission?: string;
      province?: string;
      targetArmyId?: number;
    };
    const where =
      a.province ||
      (a.targetArmyId
        ? formatArmyLabel(picture, a.targetArmyId)
        : a.targetNation != null
          ? `nation ${a.targetNation}`
          : null);
    if (!where || where.includes("?")) return "";
    return `${n}. advisory — Spy ${a.mission ?? "intel"} on ${where}`;
  }
  if (task.type === "constructBuilding") {
    const a = (task.args ?? {}) as {
      provinceIdOrName?: string | number;
      upgradeId?: number;
    };
    const prov = formatProvinceLabel(picture, a.provinceIdOrName);
    return `${n}. ${tag} — Build upgrade ${a.upgradeId ?? "?"} at ${prov}`;
  }
  if (task.type === "attackArmy") {
    const a = (task.args ?? {}) as { armyId?: number; targetArmyId?: number };
    return `${n}. ${tag} — Attack ${formatArmyLabel(picture, a.armyId)} → ${formatArmyLabel(picture, a.targetArmyId)}`;
  }
  if (task.type === "delayArmy") {
    const a = (task.args ?? {}) as { armyId?: number; minutes?: number };
    return `${n}. ${tag} — Halt ${formatArmyLabel(picture, a.armyId)} for ${a.minutes ?? "?"} min`;
  }
  const args =
    quiet && !task.proposeOnly
      ? ""
      : ` ${JSON.stringify(task.args).slice(0, 80)}`;
  if (/proposeonly|spy_retask/i.test(task.type) && !Object.keys(task.args ?? {}).length) {
    return "";
  }
  return `${n}. ${tag} ${task.type}${args}`;
}

export function planHasExecutable(plan: CabinetPlan): boolean {
  return classifyTasks(plan.tasks).executable.length > 0;
}

export function formatHumanPlan(
  plan: CabinetPlan,
  quiet: boolean,
  picture?: WarPictureRaw | null,
): string {
  const { executable } = classifyTasks(plan.tasks);
  const lines = plan.tasks
    .map((t, i) => humanTask(t, i, quiet, picture))
    .filter(Boolean);
  // renumber after filtering blanks
  const numbered = lines.map((line, i) => line.replace(/^\d+\./, `${i + 1}.`));

  const out = [
    `PLAN ${plan.id}`,
    plan.goalSummary ? `Goal: ${plan.goalSummary}` : null,
    plan.assumptions.length
      ? `Notes: ${plan.assumptions.slice(0, 3).join("; ")}`
      : null,
    "",
    ...numbered,
    "",
    executable.length
      ? "Tap buttons below, or reply: approve all · approve 1 and 2 · skip 3 · reject"
      : "Advice only — nothing to approve. Ask for moves/builds if you want an executable PLAN.",
  ];
  return out.filter((l) => l !== null).join("\n");
}
