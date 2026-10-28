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
  const badge = task.proposeOnly ? "📋 advice" : "▶️ will run";
  if (task.type === "moveArmy") {
    const a = (task.args ?? {}) as { armyId?: number; x?: number; y?: number };
    const label = formatArmyLabel(picture, a.armyId);
    const destName = provinceFromTaskText(task);
    const dest =
      destName ??
      (a.x != null && a.y != null ? `(${a.x}, ${a.y})` : "?");
    const showId =
      quiet && !task.proposeOnly ? label.replace(/\s*\(\d+\)/, "") : label;
    return `${n}. ${badge}\n    Move ${showId} → *${dest}*${task.template ? ` · ${task.template}` : ""}`;
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
    return `${n}. ${badge}\n    Spy ${a.mission ?? "intel"} on ${where}`;
  }
  if (task.type === "constructBuilding") {
    const a = (task.args ?? {}) as {
      provinceIdOrName?: string | number;
      upgradeId?: number;
    };
    const prov = formatProvinceLabel(picture, a.provinceIdOrName);
    return `${n}. ${badge}\n    Build upgrade ${a.upgradeId ?? "?"} at *${prov}*`;
  }
  if (task.type === "attackArmy") {
    const a = (task.args ?? {}) as { armyId?: number; targetArmyId?: number };
    return `${n}. ${badge}\n    Attack ${formatArmyLabel(picture, a.armyId)} → ${formatArmyLabel(picture, a.targetArmyId)}`;
  }
  if (task.type === "delayArmy") {
    const a = (task.args ?? {}) as { armyId?: number; minutes?: number };
    return `${n}. ${badge}\n    Halt ${formatArmyLabel(picture, a.armyId)} for ${a.minutes ?? "?"} min`;
  }
  if (task.type === "writeNews") {
    const a = (task.args ?? {}) as {
      title?: string;
      body?: string;
      anonymous?: boolean;
    };
    const title = (a.title ?? "?").trim() || "?";
    const preview = (a.body ?? "").trim().slice(0, 80);
    const anon = a.anonymous ? " · anonymous" : "";
    return `${n}. ${badge}\n    📰 Publish *${title}*${anon}${preview ? `\n    _${preview}${preview.length >= 80 ? "…" : ""}_` : ""}`;
  }
  const args =
    quiet && !task.proposeOnly
      ? ""
      : ` ${JSON.stringify(task.args).slice(0, 80)}`;
  if (
    /proposeonly|spy_retask/i.test(task.type) &&
    !Object.keys(task.args ?? {}).length
  ) {
    return "";
  }
  return `${n}. ${badge}\n    ${task.type}${args}`;
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
  const numbered = lines.map((line, i) => line.replace(/^\d+\./, `${i + 1}.`));

  const out = [
    `📜 *ORDERS FOR APPROVAL*`,
    `\`${plan.id}\``,
    plan.goalSummary ? `\n🎯 *Objective*\n${plan.goalSummary}` : null,
    plan.assumptions.length
      ? `\n📌 *Notes*\n${plan.assumptions
          .slice(0, 3)
          .map((a) => `• ${a}`)
          .join("\n")}`
      : null,
    "",
    `📋 *Actions*`,
    ...numbered,
    "",
    executable.length
      ? "Tap below, or reply: *yes* · *approve* · *do 1 and 2* · *reject*"
      : "_Advice only — nothing to run. Ask for moves/builds for an executable plan._",
  ];
  return out.filter((l) => l !== null).join("\n");
}
