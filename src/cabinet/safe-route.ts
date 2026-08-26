import type { WarPictureRaw } from "./war-types.js";
import type { PlanTask } from "./types.js";
import { provinceCoords } from "./plan-normalize.js";

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hostilePositions(picture: WarPictureRaw): { x: number; y: number }[] {
  const warIds = new Set(
    (picture.diplo?.atWar ?? []).map((w) => w.id).filter((id) => id != null),
  );
  return (picture.foreignArmies ?? [])
    .filter((a) => a.pos && (a.atWar || (a.ownerId != null && warIds.has(a.ownerId))))
    .map((a) => ({ x: a.pos!.x, y: a.pos!.y }));
}

function dangerNear(
  point: { x: number; y: number },
  hostiles: { x: number; y: number }[],
  band: number,
): number {
  let score = 0;
  for (const h of hostiles) {
    const d = dist(point, h);
    if (d < band) score += band - d;
  }
  return score;
}

/**
 * Pick 0–2 intermediate friendly province capitals that avoid known hostiles.
 * Returns waypoint coords including final destination (last entry = to).
 */
export function safeRoute(
  picture: WarPictureRaw | null | undefined,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts?: { maxWaypoints?: number },
): { x: number; y: number; province?: string }[] {
  if (!picture) return [{ ...to }];
  const hostiles = hostilePositions(picture);
  const band = picture.borderBand ?? (picture.medianSpacing ?? 200) * 0.6;
  const directDanger = dangerNear(to, hostiles, band);
  const midDanger = dangerNear(
    { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    hostiles,
    band,
  );
  if (directDanger < band * 0.15 && midDanger < band * 0.2) {
    return [{ ...to }];
  }

  const caps = (picture.ownProvinces ?? [])
    .filter((p) => p.capital && p.name)
    .map((p) => ({
      name: p.name!,
      x: p.capital!.x,
      y: p.capital!.y,
    }));
  // Also use idle own army positions as anchors
  for (const a of picture.ownArmies ?? []) {
    if (!a.pos || !a.province || a.onSea) continue;
    if (caps.some((c) => c.name === a.province)) continue;
    caps.push({ name: a.province, x: a.pos.x, y: a.pos.y });
  }

  const maxWp = opts?.maxWaypoints ?? 2;
  const waypoints: { x: number; y: number; province?: string }[] = [];
  let cur = from;
  for (let i = 0; i < maxWp; i++) {
    let best: { name: string; x: number; y: number; score: number } | null =
      null;
    for (const c of caps) {
      const toDest = dist(c, to);
      const fromCur = dist(cur, c);
      if (fromCur < 40 || toDest < 40) continue;
      // Prefer points that progress toward destination without hugging hostiles
      const progress = dist(cur, to) - toDest;
      if (progress < 20) continue;
      const dang = dangerNear(c, hostiles, band);
      const score = progress * 2 - dang - fromCur * 0.1;
      if (!best || score > best.score) {
        best = { ...c, score };
      }
    }
    if (!best || best.score < 0) break;
    waypoints.push({ x: best.x, y: best.y, province: best.name });
    cur = best;
  }
  waypoints.push({ ...to });
  return waypoints;
}

/** Expand retreat/withdraw moveArmy tasks into waypoint corridors. */
export function expandSafeRetreatMoves(
  tasks: readonly PlanTask[],
  picture: WarPictureRaw | null | undefined,
): PlanTask[] {
  if (!picture) return [...tasks];
  const out: PlanTask[] = [];
  for (const task of tasks) {
    if (task.type !== "moveArmy" || task.proposeOnly) {
      out.push(task);
      continue;
    }
    const text = `${task.rationale ?? ""} ${task.template ?? ""}`;
    const isRetreat =
      /\b(withdraw|retreat|disengage|pull(?: back)?|evacuate)\b/i.test(text);
    if (!isRetreat) {
      out.push(task);
      continue;
    }
    const args = (task.args ?? {}) as {
      armyId?: number;
      x?: number;
      y?: number;
    };
    const armyId = Number(args.armyId);
    const army = picture.ownArmies?.find((a) => a.id === armyId);
    if (!army?.pos || !Number.isFinite(args.x) || !Number.isFinite(args.y)) {
      out.push(task);
      continue;
    }
    const route = safeRoute(
      picture,
      army.pos,
      { x: Number(args.x), y: Number(args.y) },
    );
    if (route.length <= 1) {
      out.push(task);
      continue;
    }
    for (let i = 0; i < route.length; i++) {
      const wp = route[i]!;
      const via =
        wp.province && i < route.length - 1
          ? `via ${wp.province}`
          : task.rationale ?? "safe retreat";
      out.push({
        ...task,
        args: {
          armyId,
          x: wp.x,
          y: wp.y,
          append: i > 0,
        },
        rationale: via,
      });
    }
  }
  return out;
}

export function resolveDestCoords(
  picture: WarPictureRaw | null | undefined,
  province: string,
  excludeArmyId?: number,
): { x: number; y: number } | null {
  return provinceCoords(picture, province, { excludeArmyId });
}
