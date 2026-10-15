import type { CabinetEvent } from "./events.js";
import type { WarArmyRow, WarWatchSnapshot } from "./war-types.js";

export type MapDeltaKind =
  | "moved"
  | "orders_changed"
  | "province_changed"
  | "idle_flip"
  | "appeared"
  | "vanished";

export interface ArmyMapDelta {
  readonly armyId: number;
  readonly kind: MapDeltaKind;
  readonly province?: string | null;
  readonly prevProvince?: string | null;
  readonly line: string;
  readonly highSignal: boolean;
  /** True when no recent MOVE_VERIFIED / queue exec explains it. */
  readonly likelyManual: boolean;
}

export interface MapDeltaReport {
  readonly takenAt: string;
  readonly deltas: readonly ArmyMapDelta[];
  readonly manualCount: number;
  readonly highSignalLines: readonly string[];
  readonly brief: string;
}

function cmdCount(a: WarArmyRow | undefined): number {
  if (!a) return 0;
  if (typeof a.commandCount === "number") return a.commandCount;
  if (typeof a.commands === "number") return a.commands;
  if (Array.isArray(a.commands)) return a.commands.length;
  return 0;
}

function posKey(a: WarArmyRow | undefined): string {
  if (!a?.pos) return "";
  return `${Math.round(a.pos.x)},${Math.round(a.pos.y)}`;
}

function dist(a: WarArmyRow, b: WarArmyRow): number {
  if (!a.pos || !b.pos) return Infinity;
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  return Math.hypot(dx, dy);
}

/** Army ids recently verified by cabinet/queue (not player UI). */
export function recentCabinetArmyIds(
  events: readonly CabinetEvent[],
  withinMs = 120_000,
  now = Date.now(),
): Set<number> {
  const out = new Set<number>();
  for (const e of events) {
    if (e.kind !== "MOVE_VERIFIED" && e.kind !== "GENERAL_ORDER_CREATED") {
      continue;
    }
    const t = Date.parse(e.t);
    if (!Number.isFinite(t) || now - t > withinMs) continue;
    const army = e.payload?.army;
    if (typeof army === "number") out.add(army);
    const armyId = e.payload?.armyId;
    if (typeof armyId === "number") out.add(armyId);
  }
  return out;
}

/**
 * Diff own armies between war-watch snapshots.
 * Changes not covered by recent cabinet MOVE_VERIFIED are marked likelyManual.
 */
export function diffOwnArmies(
  previous: WarWatchSnapshot | null | undefined,
  current: WarWatchSnapshot,
  cabinetArmyIds: ReadonlySet<number> = new Set(),
): MapDeltaReport {
  const takenAt = current.takenAt;
  if (!previous?.picture?.ownArmies?.length) {
    return {
      takenAt,
      deltas: [],
      manualCount: 0,
      highSignalLines: [],
      brief: "",
    };
  }

  const prevMap = new Map(
    (previous.picture.ownArmies ?? []).map((a) => [a.id, a] as const),
  );
  const curMap = new Map(
    (current.picture.ownArmies ?? []).map((a) => [a.id, a] as const),
  );
  const hotProvinces = new Set(
    (previous.fronts ?? [])
      .filter((f) => f.level === "high" || f.atWar)
      .flatMap((f) => f.borderProvinces ?? []),
  );

  const deltas: ArmyMapDelta[] = [];

  for (const [id, cur] of curMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      const likelyManual = !cabinetArmyIds.has(id);
      deltas.push({
        armyId: id,
        kind: "appeared",
        province: cur.province,
        line: `army ${id} appeared at ${cur.province ?? (posKey(cur) || "?")}`,
        highSignal: false,
        likelyManual,
      });
      continue;
    }

    const moved = dist(prev, cur) >= 8 || posKey(prev) !== posKey(cur);
    const provChanged =
      !!prev.province &&
      !!cur.province &&
      prev.province !== cur.province;
    const ordersChanged = cmdCount(prev) !== cmdCount(cur);
    const idleFlip =
      typeof prev.idle === "boolean" &&
      typeof cur.idle === "boolean" &&
      prev.idle !== cur.idle;

    if (!moved && !provChanged && !ordersChanged && !idleFlip) continue;

    const likelyManual = !cabinetArmyIds.has(id);
    let kind: MapDeltaKind = "moved";
    if (provChanged && !moved) kind = "province_changed";
    else if (ordersChanged && !moved) kind = "orders_changed";
    else if (idleFlip && !moved && !ordersChanged) kind = "idle_flip";

    const leftHot =
      !!prev.province &&
      hotProvinces.has(prev.province) &&
      (provChanged || (idleFlip && cur.idle === true));
    const cancelledApproach =
      cmdCount(prev) > 0 && cmdCount(cur) === 0 && (cur.idle === true || idleFlip);

    const where = provChanged
      ? `${prev.province ?? "?"} → ${cur.province ?? "?"}`
      : cur.province || posKey(cur) || "map";
    const action = cancelledApproach
      ? "stopped / cleared orders"
      : idleFlip && cur.idle
        ? "now idle"
        : idleFlip && !cur.idle
          ? "now moving"
          : moved || provChanged
            ? "repositioned"
            : ordersChanged
              ? "orders changed"
              : "updated";
    const who = likelyManual ? "looks like your click" : "cabinet path";
    const line = `• ${where} — ${action} (${who})`;

    deltas.push({
      armyId: id,
      kind,
      province: cur.province,
      prevProvince: prev.province,
      line,
      highSignal: leftHot || cancelledApproach,
      likelyManual,
    });
  }

  for (const [id, prev] of prevMap) {
    if (curMap.has(id)) continue;
    deltas.push({
      armyId: id,
      kind: "vanished",
      prevProvince: prev.province,
      province: prev.province,
      line: `• ${prev.province ?? (posKey(prev) || "stack")} — no longer on the picture`,
      highSignal: true,
      likelyManual: !cabinetArmyIds.has(id),
    });
  }

  const manual = deltas.filter((d) => d.likelyManual);
  const highSignalLines = deltas
    .filter((d) => d.highSignal)
    .map((d) => d.line)
    .slice(0, 5);

  const briefLines = manual.slice(0, 8).map((d) => `  - ${d.line}`);
  const brief = briefLines.length
    ? [
        `Field changes since last watch (likely player UI, not cabinet):`,
        ...briefLines,
      ].join("\n")
    : "";

  return {
    takenAt,
    deltas,
    manualCount: manual.length,
    highSignalLines,
    brief,
  };
}

export function formatMapDeltaBrief(report: MapDeltaReport | null): string {
  if (!report?.brief) return "";
  return report.brief;
}
