import { isPhase1Executable, type PlanTask } from "./types.js";
import type { WarPictureRaw } from "./war-types.js";
import { uniqueNameMatch } from "../utils/name-match.js";
import { cleanPlanTasks } from "./plan-dedupe.js";
import { resolveProvinceId } from "./army-labels.js";

/** Placeholder coords copied from prompts — never execute blindly. */
const PLACEHOLDER_COORDS = new Set([
  "811.28,145.04",
  "811.28,145.040",
  "0,0",
]);

function coordKey(x: number, y: number): string {
  return `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
}

function isPlaceholderCoord(x: number, y: number): boolean {
  return PLACEHOLDER_COORDS.has(coordKey(x, y));
}

/** Resolve map coords for a province name from the latest war picture. */
export function provinceCoords(
  picture: WarPictureRaw | null | undefined,
  province: string,
  opts?: { excludeArmyId?: number },
): { x: number; y: number } | null {
  if (!picture || !province.trim()) return null;
  const needle = province.trim().toLowerCase();

  const ownProv = picture.ownProvinces ?? [];
  const hitProv =
    uniqueNameMatch(ownProv, province, (p) => p.name) ??
    uniqueNameMatch(ownProv, foldAccents(province), (p) =>
      foldAccents(p.name ?? ""),
    );
  if (hitProv?.capital) {
    const x = Number(hitProv.capital.x);
    const y = Number(hitProv.capital.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }

  const armies = [
    ...(picture.ownArmies ?? []),
    ...(picture.foreignArmies ?? []),
  ];
  const namedArmies = armies.filter(
    (a) => a.pos && a.id !== opts?.excludeArmyId,
  );
  const hitArmy = uniqueNameMatch(namedArmies, province, (a) => a.province);
  if (hitArmy?.pos) {
    const x = Number(hitArmy.pos.x);
    const y = Number(hitArmy.pos.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  const selfArmy = armies.find(
    (a) =>
      a.pos &&
      a.id === opts?.excludeArmyId &&
      (a.province ?? "").toLowerCase() === needle,
  );
  if (selfArmy?.pos) {
    const x = Number(selfArmy.pos.x);
    const y = Number(selfArmy.pos.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
}

/** Allow accented names (Béchar, Königsberg) — ASCII-only class missed them. */
const DEST_FROM_TEXT_RE =
  /\b(?:withdraw to|pull(?: back)? to|redirect to|move to|merge (?:at|with)|screen at|hold at|concentrate at|join at|toward|→|to)\s+([\p{Lu}][\p{L} .'-]{2,40})/u;

function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Destination province from rationale / goal — prefers "to Whitehorse" over "out of New Arkhangelsk". */
export function destinationProvinceFromText(
  ...texts: Array<string | null | undefined>
): string | null {
  const blob = texts.filter(Boolean).join(" ");
  if (!blob.trim()) return null;
  const m = blob.match(DEST_FROM_TEXT_RE);
  if (m?.[1]) {
    return m[1].replace(/[.,;:]+$/, "").trim();
  }
  // Accent / punctuation fallback: "to bechar" / "to Béchar"
  const soft = blob.match(
    /\b(?:to|at|toward|→)\s+([A-Za-z\u00C0-\u024F][\w\u00C0-\u024F .'-]{2,40})/i,
  );
  if (soft?.[1]) {
    return soft[1].replace(/[.,;:]+$/, "").trim();
  }
  return null;
}

/** Pull destination province name from rationale / args text. */
export function provinceFromTaskText(task: PlanTask): string | null {
  const args = (task.args ?? {}) as Record<string, unknown>;
  const explicit = String(
    args.targetProvince ?? args.province ?? args.provinceIdOrName ?? "",
  ).trim();
  if (explicit) return explicit;

  return destinationProvinceFromText(task.rationale, task.template);
}

function mapCoordBBox(picture: WarPictureRaw | null | undefined): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  const pts = [
    ...(picture?.ownArmies ?? []),
    ...(picture?.foreignArmies ?? []),
  ]
    .map((a) => a.pos)
    .filter((p): p is { x: number; y: number } => !!p && Number.isFinite(p.x));
  for (const p of picture?.ownProvinces ?? []) {
    if (p.capital && Number.isFinite(p.capital.x)) pts.push(p.capital);
  }
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Earth lat/long range — S1914 map coords are typically hundreds–thousands. */
function looksLikeLatLong(x: number, y: number): boolean {
  return Math.abs(x) <= 180 && Math.abs(y) <= 90;
}

/** Reject LLM lat/long invents like (-136, 60) when the map uses different scale. */
function coordsInMapScale(
  picture: WarPictureRaw | null | undefined,
  x: number,
  y: number,
): boolean {
  if (looksLikeLatLong(x, y)) return false;
  const box = mapCoordBBox(picture);
  if (!box) return true;
  const padX = Math.max(150, (box.maxX - box.minX) * 0.75);
  const padY = Math.max(150, (box.maxY - box.minY) * 0.75);
  return (
    x >= box.minX - padX &&
    x <= box.maxX + padX &&
    y >= box.minY - padY &&
    y <= box.maxY + padY
  );
}

const COAST_INTENT_RE = /\b(coast|sea|waters?|naval|fleet|offshore|harbor|harbour)\b/i;

/** Offset a land capital toward water for sea units (rough coastal parking). */
function coastalOffsetFrom(
  picture: WarPictureRaw,
  land: { x: number; y: number },
  armyPos: { x: number; y: number } | null,
): { x: number; y: number } {
  // Prefer offset from army's current sea position toward the land point,
  // stopping short of the capital so the click stays on water.
  if (armyPos) {
    const dx = land.x - armyPos.x;
    const dy = land.y - armyPos.y;
    const len = Math.hypot(dx, dy) || 1;
    // Park ~90 map units short of the capital along the approach vector.
    const pull = Math.min(90, len * 0.35);
    return {
      x: land.x - (dx / len) * pull,
      y: land.y - (dy / len) * pull,
    };
  }
  // Fallback: nudge west/south (common Pacific approaches on this map).
  void picture;
  return { x: land.x - 80, y: land.y + 40 };
}

/** Re-resolve moveArmy coords from province names; drop placeholder / off-map coords. */
export function resolveMoveArmyCoords(
  tasks: readonly PlanTask[],
  picture: WarPictureRaw | null | undefined,
  goalSummary?: string | null,
): PlanTask[] {
  return tasks.flatMap((task) => {
    if (task.type !== "moveArmy") return [task];
    const args = (task.args ?? {}) as {
      armyId?: number;
      x?: number;
      y?: number;
      append?: boolean;
    };
    const armyId = Number(args.armyId);
    if (!Number.isFinite(armyId) || armyId <= 0) {
      return []; // incomplete moveArmy — drop
    }
    let x = Number(args.x);
    let y = Number(args.y);
    const resolveOpts = { excludeArmyId: armyId };
    const army = picture?.ownArmies?.find((a) => a.id === armyId);
    const onSea = !!army?.onSea;
    const armyPos =
      army?.pos && Number.isFinite(army.pos.x)
        ? { x: army.pos.x, y: army.pos.y }
        : null;

    // Per-task destination only — do NOT scan whole goalSummary (avoids
    // "to Winnipeg" rewriting an unrelated fleet task).
    let destProvince = provinceFromTaskText(task);
    if (!destProvince) {
      destProvince = destinationProvinceFromText(task.rationale);
    }
    // Only use goalSummary when the task itself has no usable dest AND coords
    // are missing/off-map (still prefer coast intent for sea units).
    const rationaleCoast = COAST_INTENT_RE.test(
      `${task.rationale ?? ""} ${task.template ?? ""}`,
    );
    const inScaleAlready =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      coordsInMapScale(picture, x, y) &&
      !isPlaceholderCoord(x, y);

    if (destProvince && picture && !(onSea && inScaleAlready && rationaleCoast)) {
      const resolved = provinceCoords(picture, destProvince, resolveOpts);
      if (resolved) {
        if (onSea) {
          const coast = coastalOffsetFrom(picture, resolved, armyPos);
          x = coast.x;
          y = coast.y;
        } else {
          x = resolved.x;
          y = resolved.y;
        }
      }
    }

    // Bare lat/long / missing dest: only use goalSummary destination, never map-specific names.
    if (
      picture &&
      !(onSea && inScaleAlready && rationaleCoast) &&
      (!destProvince || !coordsInMapScale(picture, x, y))
    ) {
      const fromGoal =
        !destProvince && !inScaleAlready
          ? destinationProvinceFromText(goalSummary)
          : null;
      const fallback = fromGoal || null;
      if (fallback) {
        destProvince = destProvince || fallback;
        const resolved = provinceCoords(picture, fallback, resolveOpts);
        if (resolved) {
          if (onSea) {
            const coast = coastalOffsetFrom(picture, resolved, armyPos);
            x = coast.x;
            y = coast.y;
          } else {
            x = resolved.x;
            y = resolved.y;
          }
        }
      }
    }

    // Known inland provinces that ships must never target as capitals.
    const inlandNames =
      /\b(Winnipeg|Albuquerque|Davenport|Des Moines|Little Rock|Mexico City)\b/i;
    if (onSea && destProvince && inlandNames.test(destProvince)) {
      return [
        {
          ...task,
          args: { armyId, x, y, append: args.append },
          proposeOnly: true,
          rationale:
            (task.rationale ?? "") +
            ` [sea unit cannot move inland to ${destProvince} — name a coast]`,
        },
      ];
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return [
        {
          ...task,
          args: { armyId, x, y, append: args.append },
          proposeOnly: true,
          rationale:
            (task.rationale ?? "") +
            " [needs coords — name target province in rationale]",
        },
      ];
    }

    const badScale = !coordsInMapScale(picture, x, y);
    if (isPlaceholderCoord(x, y) || badScale) {
      if (destProvince && picture) {
        const resolved = provinceCoords(picture, destProvince, resolveOpts);
        if (resolved) {
          if (onSea) {
            const coast = coastalOffsetFrom(picture, resolved, armyPos);
            x = coast.x;
            y = coast.y;
          } else {
            x = resolved.x;
            y = resolved.y;
          }
        } else {
          return [
            {
              ...task,
              args: { armyId, x, y, append: args.append },
              proposeOnly: true,
              rationale:
                (task.rationale ?? "") +
                ` [${badScale ? "off-map" : "placeholder"} coords — could not resolve ${destProvince}]`,
            },
          ];
        }
      } else {
        return [
          {
            ...task,
            args: { armyId, x, y, append: args.append },
            proposeOnly: true,
            rationale:
              (task.rationale ?? "") +
              ` [${badScale ? "off-map coords like lat/long" : "placeholder coords"} — name destination province]`,
          },
        ];
      }
    }

    return [
      {
        ...task,
        type: "moveArmy",
        args: { armyId, x, y, append: args.append },
        proposeOnly: task.proposeOnly,
        rationale: destProvince
          ? task.rationale ??
            (onSea
              ? `move to water off ${destProvince}`
              : `move to ${destProvince}`)
          : task.rationale,
      },
    ];
  });
}

function clearExecutableProposeOnly(task: PlanTask): PlanTask {
  if (task.proposeOnly && isPhase1Executable(task.type)) {
    const { proposeOnly: _, ...rest } = task;
    return rest;
  }
  return task;
}

/** Fix chief/minister tasks that used wrong type names or province-only move args. */
export function normalizePlanTasks(
  tasks: readonly PlanTask[],
  picture: WarPictureRaw | null | undefined,
  goalSummary?: string | null,
): PlanTask[] {
  const out: PlanTask[] = [];
  for (const raw of tasks) {
    const t = raw as PlanTask;
    const args = (t.args ?? {}) as Record<string, unknown>;
    const typeRaw = String(t.type ?? "").trim();
    const type = typeRaw.toLowerCase();

    if (
      type.includes("spy") ||
      args.mission != null ||
      args.targetNation != null
    ) {
      out.push({
        ...t,
        type: type === "proposeonly" || !typeRaw ? "spyMission" : t.type,
        proposeOnly: true,
        args,
      });
      continue;
    }

    const armyId = Number(args.armyId);
    const province = String(
      args.targetProvince ?? args.province ?? args.provinceIdOrName ?? "",
    ).trim();

    const looksLikeMove =
      Number.isFinite(armyId) &&
      armyId > 0 &&
      province.length > 0 &&
      (type === "proposeonly" ||
        type === "move" ||
        type === "retreat" ||
        type === "screen" ||
        !isPhase1Executable(t.type));

    if (looksLikeMove) {
      const coords = provinceCoords(picture, province, {
        excludeArmyId: armyId,
      });
      if (coords) {
        out.push(
          clearExecutableProposeOnly({
            type: "moveArmy",
            args: { armyId, x: coords.x, y: coords.y },
            risk: t.risk ?? "medium",
            rationale: t.rationale ?? `move to ${province}`,
            template: t.template,
          }),
        );
        continue;
      }
    }

    if (type === "movearmy") {
      const x = Number(args.x);
      const y = Number(args.y);
      if (Number.isFinite(armyId) && Number.isFinite(x) && Number.isFinite(y)) {
        out.push(
          clearExecutableProposeOnly({
            ...t,
            type: "moveArmy",
            args: { armyId, x, y },
          }),
        );
        continue;
      }
    }

    if (
      type === "constructbuilding" &&
      isPhase1Executable("constructBuilding")
    ) {
      const rawProv = args.provinceIdOrName ?? args.province;
      const resolved = resolveProvinceId(picture, rawProv as string | number);
      out.push(
        clearExecutableProposeOnly({
          ...t,
          type: "constructBuilding",
          args: {
            provinceIdOrName: resolved ?? rawProv,
            upgradeId: args.upgradeId,
          },
          rationale: t.rationale ?? `build at ${String(rawProv)}`,
        }),
      );
      continue;
    }

    out.push(clearExecutableProposeOnly({ ...t, args }));
  }
  return cleanPlanTasks(resolveMoveArmyCoords(out, picture, goalSummary));
}
