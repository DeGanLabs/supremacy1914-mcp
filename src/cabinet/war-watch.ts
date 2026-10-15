import type {
  WarAlert,
  WarArmyRow,
  WarFrontRow,
  WarPictureRaw,
  WarTrigger,
  WarWatchSnapshot,
  WatchLevel,
  WatchZone,
} from "./war-types.js";
import { armyCommandCount } from "./display-format.js";
import { isShareMapFront } from "./war-trust.js";

const DEDUP_MS = 15 * 60 * 1000;
/** Coarse land speed assumption for ETA (map units per game-hour). */
const LAND_SPEED = 8;

function unitCount(a: WarArmyRow): number {
  if (!a.units?.length) return 1;
  return a.units.reduce((s, u) => s + (Number(u.size) || 1), 0);
}

function nationOf(a: WarArmyRow): string {
  return a.nation || a.owner || `p${a.ownerId ?? "?"}`;
}

function isCompleteAlert(t: WarTrigger): boolean {
  return !!(t.armyId != null || (t.province && t.province.trim()));
}

function nearBand(picture: WarPictureRaw): number {
  return picture.borderBand ?? (picture.medianSpacing ?? 50) * 1.5;
}

export function scoreWarPicture(
  picture: WarPictureRaw,
  previous: WarWatchSnapshot | null,
): WarWatchSnapshot {
  const takenAt = picture.takenAt || new Date().toISOString();
  const atWarRaw = picture.diplo?.atWar ?? [];
  const atWar = atWarRaw.filter(
    (w) =>
      !w.defeated &&
      w.status !== "defeated" &&
      w.status !== "ghost",
  );
  const own = picture.ownArmies ?? [];
  const foreign = picture.foreignArmies ?? [];
  const borders = picture.borders ?? [];
  const band = nearBand(picture);
  const sensorDegraded = !!picture.sensorDegraded;

  // Score / refresh fronts — never HIGH for defeated/ghost paper wars
  const fronts: WarFrontRow[] = (picture.fronts ?? [])
    .filter((f) => f.status !== "defeated" && f.status !== "ghost")
    .map((f) => {
      const contact =
        (f.ownArmyIds?.length ?? 0) > 0 ||
        (f.hostileArmyIds?.length ?? 0) > 0 ||
        (f.borderProvinces?.length ?? 0) > 0;
      let level: WatchLevel = "low";
      if (f.atWar && f.status === "active" && contact) level = "high";
      else if (f.atWar && f.status === "dormant") level = "low";
      else if (isShareMapFront(f)) level = "low";
      else if (f.atWar && contact) level = "medium";
      else if (!f.atWar && (f.hostileArmyIds?.length ?? 0) > 0) level = "medium";
      else if (!f.atWar && contact) level = "medium";
      return { ...f, level };
    });

  const zones: WatchZone[] = [];
  for (const f of fronts) {
    const tags: string[] = [];
    if (f.atWar) tags.push("AT_WAR");
    if (f.status) tags.push(`STATUS:${f.status}`);
    const nearest = f.nearestHostile;
    if (nearest?.onSea) tags.push("COASTAL_HOSTILE");
    const borderCoastal = borders.some(
      (b) => b.facingPlayerId === f.playerId && b.coastal,
    );
    if (borderCoastal) tags.push("FORT_COASTAL");
    zones.push({
      id: `front:${f.playerId}`,
      level: f.level,
      nation: f.name,
      playerId: f.playerId,
      provinces: f.borderProvinces.slice(0, 8),
      ownArmyIds: f.ownArmyIds,
      hostileArmyIds: f.hostileArmyIds,
      note: nearest
        ? `nearest hostile army ${nearest.armyId} @ ${nearest.province ?? "?"} d=${nearest.distance}`
        : f.status === "dormant"
          ? "dormant remnant — paper threat"
          : "no visible hostile stack",
      tags,
    });
  }

  // Orphan live wars with no border cluster — only if still active on map
  for (const w of atWar) {
    if (w.status === "defeated" || w.status === "ghost") continue;
    if (w.defeated) continue;
    if (zones.some((z) => z.playerId === w.id)) continue;
    const hostiles = foreign.filter((a) => a.ownerId === w.id);
    const level: WatchLevel =
      w.status === "active" && hostiles.length > 0
        ? "medium"
        : w.status === "active"
          ? "low"
          : "low";
    zones.push({
      id: `war:${w.id}`,
      level,
      nation: w.nation || w.name || `p${w.id}`,
      playerId: w.id,
      provinces: borders
        .filter((b) => b.facingPlayerId === w.id)
        .map((b) => b.province)
        .slice(0, 6),
      ownArmyIds: [],
      hostileArmyIds: hostiles.map((a) => a.id),
      note:
        w.status === "active"
          ? `live war, no shared border yet (prov=${w.provincesKnown ?? "?"}/armies=${w.armiesKnown ?? "?"})`
          : `paper/dormant war (${w.status}) — ignore for ops`,
      tags: ["AT_WAR", `STATUS:${w.status ?? "unknown"}`],
    });
  }

  const triggers: WarTrigger[] = [];
  const prevWars = new Set((previous?.atWar ?? []).map((w) => w.id));
  const curWars = new Set(atWar.map((w) => w.id));

  if (sensorDegraded) {
    triggers.push({
      kind: "SENSOR_DEGRADED",
      level: "high",
      key: "sensor_degraded",
      line: "HIGH SENSOR: war picture empty while bridge up — rebind/paste console",
      province: picture.myNation || "self",
    });
  }

  for (const w of atWar) {
    if (!previous) break; // baseline snapshot — no NEW_WAR flood
    if (!prevWars.has(w.id)) {
      const nation = w.nation || w.name || `p${w.id}`;
      const prov =
        borders.find((b) => b.facingPlayerId === w.id)?.province || nation;
      triggers.push({
        kind: "NEW_WAR",
        level: "high",
        key: `new_war:${w.id}`,
        nation,
        province: prov,
        line: `HIGH NEW_WAR ${nation}: open front @ ${prov} — propose concentrate /approve?`,
        escalateAll: true,
        handoff: "foreign",
      });
    }
  }
  for (const id of prevWars) {
    if (!previous) break;
    if (!curWars.has(id)) {
      const prev = previous?.atWar.find((w) => w.id === id);
      const nation = prev?.nation || prev?.name || `p${id}`;
      triggers.push({
        kind: "WAR_ENDED",
        level: "medium",
        key: `war_ended:${id}`,
        nation,
        province: nation,
        line: `MED WAR_ENDED ${nation}: recalibrate garrisons`,
        handoff: "foreign",
      });
    }
  }

  // Relation drops vs previous diplo rows stored lightly in zones
  const prevRel = new Map<number, number>();
  for (const z of previous?.zones ?? []) {
    const old = previous?.picture.diplo?.atWar?.find((w) => w.id === z.playerId);
    if (old?.relation != null) prevRel.set(z.playerId, old.relation);
  }
  for (const row of [
    ...(picture.diplo?.embargo ?? []),
    ...(picture.diplo?.ceasefire ?? []),
  ]) {
    if (!previous) break;
    const prev = prevRel.get(row.id);
    if (prev != null && row.relation != null && row.relation < prev) {
      const nation = row.nation || row.name || `p${row.id}`;
      triggers.push({
        kind: "RELATION_DROP",
        level: "medium",
        key: `rel_drop:${row.id}:${row.relation}`,
        nation,
        province: nation,
        line: `MED RELATION_DROP ${nation} → ${row.label ?? row.relation} — @Foreign isolate?`,
        handoff: "foreign",
      });
    }
  }

  const prevFrontIds = new Set((previous?.fronts ?? []).map((f) => f.playerId));
  for (const f of fronts) {
    if (!previous) break;
    if (f.level === "high" && !prevFrontIds.has(f.playerId)) {
      const prov = f.borderProvinces[0] || f.name;
      triggers.push({
        kind: "FRONT_OPENED",
        level: "high",
        key: `front_open:${f.playerId}`,
        nation: f.name,
        province: prov,
        armyId: f.ownArmyIds[0] ?? f.nearestHostile?.armyId,
        line: `HIGH FRONT_OPENED ${f.name}: watch ${prov} — propose reinforce /approve?`,
      });
    }
  }
  for (const id of prevFrontIds) {
    if (!previous) break;
    if (!fronts.some((f) => f.playerId === id)) {
      const old = previous?.fronts.find((f) => f.playerId === id);
      triggers.push({
        kind: "FRONT_CLOSED",
        level: "low",
        key: `front_close:${id}`,
        nation: old?.name || `p${id}`,
        province: old?.borderProvinces[0] || old?.name || `p${id}`,
        line: `LOW FRONT_CLOSED ${old?.name ?? id}`,
      });
    }
  }

  // Hostile near / idle on hot / coastal
  const trustedIds = new Set<number>();
  for (const r of picture.diplo?.nap ?? []) trustedIds.add(r.id);
  for (const r of picture.diplo?.rightOfWay ?? []) trustedIds.add(r.id);
  for (const r of picture.diplo?.shareMapOrBetter ?? []) trustedIds.add(r.id);
  for (const id of (picture.diplo as { allies?: number[] })?.allies ?? []) {
    if (typeof id === "number") trustedIds.add(id);
  }

  for (const fa of foreign) {
    const d = fa.distToBorder ?? fa.distToSelf ?? Infinity;
    if (!(d <= band)) continue;
    const nation = nationOf(fa);
    const atWarContact = !!fa.atWar || atWar.some((w) => w.id === fa.ownerId);
    if (atWarContact) {
      triggers.push({
        kind: "HOSTILE_NEAR",
        level: "high",
        key: `hostile_near:${fa.id}`,
        armyId: fa.id,
        province: fa.province || nation,
        nation,
        line: `HIGH HOSTILE_NEAR army ${fa.id} @ ${fa.province || (fa.onSea ? "at sea" : "unknown province")} (${nation}) d=${Math.round(d)}`,
      });
      if (fa.onSea) {
        const ship = own.find((o) => o.onSea);
        triggers.push({
          kind: "COASTAL_HOSTILE",
          level: "high",
          key: `coastal:${fa.id}`,
          armyId: ship?.id ?? fa.id,
          province: fa.province || nation,
          nation,
          line: `HIGH COASTAL_HOSTILE ${nation} @ ${fa.province ?? "?"} — bombard plan ship ${ship?.id ?? "?"} → stack ${fa.id} /approve?`,
        });
        if (fa.onSea && !fa.detailsVisible) {
          /* embarked often shows as sea stack */
        }
        const looksEmbarked =
          fa.onSea &&
          (fa.units || []).some((u) =>
            /infantry|artillery|tank|cavalry|bomber/i.test(String(u.name || "")),
          );
        if (looksEmbarked || (fa.onSea && atWarContact)) {
          triggers.push({
            kind: "EMBARKED_NEAR",
            level: "high",
            key: `embarked:${fa.id}`,
            armyId: fa.id,
            province: fa.province || nation,
            nation,
            line: `HIGH EMBARKED_NEAR army ${fa.id} @ ${fa.province ?? "?"} — kill-transport before land /approve?`,
          });
        }
      }
    } else if (d <= band * 0.75) {
      if (!previous) continue; // baseline: skip NEW_VISIBLE_STACK flood
      if (fa.ownerId != null && trustedIds.has(fa.ownerId)) continue;
      triggers.push({
        kind: "NEW_VISIBLE_STACK",
        level: "medium",
        key: `stack:${fa.id}`,
        armyId: fa.id,
        province: fa.province || nation,
        nation,
        line: `MED stack ${fa.id} @ ${fa.province ?? "?"} (${nation}) near border`,
      });
    }
  }

  for (const oa of own) {
    if (!oa.idle && armyCommandCount(oa) > 0) continue;
    for (const fa of foreign) {
      if (!fa.atWar && !atWar.some((w) => w.id === fa.ownerId)) continue;
      const dOwn = (() => {
        if (!oa.pos || !fa.pos) return Infinity;
        const dx = oa.pos.x - fa.pos.x;
        const dy = oa.pos.y - fa.pos.y;
        return Math.sqrt(dx * dx + dy * dy);
      })();
      if (dOwn <= band) {
        const sameHex =
          oa.province &&
          fa.province &&
          oa.province === fa.province;
        const contactDist =
          oa.pos && fa.pos
            ? Math.hypot(oa.pos.x - fa.pos.x, oa.pos.y - fa.pos.y)
            : Infinity;
        const criticalContact =
          sameHex ||
          contactDist <= (picture.medianSpacing ?? 40) * 0.35;
        if (criticalContact) {
          triggers.push({
            kind: "OWN_ARMY_CONTACT",
            level: "high",
            key: `contact:${oa.id}:${fa.id}`,
            armyId: oa.id,
            province: oa.province || "?",
            nation: nationOf(fa),
            line: `HIGH contact army ${oa.id} @ ${oa.province ?? "?"} vs ${nationOf(fa)} ${fa.id}`,
          });
        }
        // One idle note per army per tick (digest summarizes by front)
        triggers.push({
          kind: "IDLE_ON_HOT_FRONT",
          level: "high",
          key: `idle:${oa.id}:${fa.id}`,
          armyId: oa.id,
          province: oa.province || fa.province || "?",
          nation: nationOf(fa),
          line: `HIGH IDLE_ON_HOT_FRONT: army ${oa.id} idle at ${oa.province ?? "?"} — screen or pull back on ${nationOf(fa)} front`,
        });
        break;
      }
    }
  }

  // Spy gaps on war neighbors (one trigger per neighbor — no duplicate NEED_SPY handoff)
  for (const fog of picture.spies?.fog ?? []) {
    triggers.push({
      kind: "SPY_GAP_WAR_NEIGHBOR",
      level: "medium",
      key: `spy_gap:${fog.playerId}`,
      nation: fog.nation || `p${fog.playerId}`,
      province:
        borders.find((b) => b.facingPlayerId === fog.playerId)?.province ||
        fog.nation ||
        `p${fog.playerId}`,
      line: `MED SPY_GAP ${fog.nation ?? fog.playerId} — ask @Intel for placement`,
      handoff: "intel",
      needSpyProvince:
        borders.find((b) => b.facingPlayerId === fog.playerId)?.facingProvince ||
        borders.find((b) => b.facingPlayerId === fog.playerId)?.province,
    });
  }

  // Force ratio flip per front
  for (const f of fronts) {
    const prev = previous?.fronts.find((x) => x.playerId === f.playerId);
    if (!prev) continue;
    const wasStrong = (prev.ownStrength ?? 0) >= (prev.hostileStrength ?? 0);
    const nowStrong = (f.ownStrength ?? 0) >= (f.hostileStrength ?? 0);
    if (wasStrong !== nowStrong) {
      triggers.push({
        kind: "FORCE_RATIO_FLIP",
        level: "high",
        key: `ratio:${f.playerId}:${f.ownStrength}:${f.hostileStrength}`,
        nation: f.name,
        province: f.borderProvinces[0] || f.name,
        armyId: f.ownArmyIds[0],
        line: `HIGH FORCE_RATIO_FLIP ${f.name}: own ${f.ownStrength} vs hostile ${f.hostileStrength} — @Finance munitions?`,
        handoff: "finance",
      });
    }
    if (
      prev.hostileStrength != null &&
      f.hostileStrength != null &&
      f.hostileStrength < prev.hostileStrength
    ) {
      triggers.push({
        kind: "REINFORCEMENT_WINDOW",
        level: "medium",
        key: `thin:${f.playerId}:${f.hostileStrength}`,
        nation: f.name,
        province: f.borderProvinces[0] || f.name,
        armyId: f.ownArmyIds[0],
        line: `MED REINFORCEMENT_WINDOW ${f.name}: hostile thinning ${prev.hostileStrength}→${f.hostileStrength} — push? /approve?`,
      });
    }
  }

  const highZones = zones.filter((z) => z.level === "high");
  if (highZones.length >= 2) {
    triggers.push({
      kind: "MULTI_FRONT",
      level: "high",
      key: `multi:${highZones.map((z) => z.playerId).sort().join(",")}`,
      nation: highZones.map((z) => z.nation).join("+"),
      province: highZones[0]!.provinces[0] || highZones[0]!.nation,
      armyId: highZones[0]!.ownArmyIds[0],
      escalateAll: true,
      line: `HIGH MULTI_FRONT (${highZones.length}): ${highZones.map((z) => z.nation).join(", ")} — @all prioritize`,
    });
  }

  // Dedup vs previous alert keys
  const prevKeys = previous?.alertKeys ?? {};
  const now = Date.now();
  const alertKeys: Record<string, string> = { ...prevKeys };
  const fresh: WarTrigger[] = [];
  for (const t of triggers) {
    if (!isCompleteAlert(t)) {
      console.warn("INCOMPLETE_ALERT", t.kind, t.key);
      continue;
    }
    const last = prevKeys[t.key];
    if (last) {
      const age = now - Date.parse(last);
      if (Number.isFinite(age) && age < DEDUP_MS) continue;
    }
    alertKeys[t.key] = takenAt;
    fresh.push(t);
  }

  return {
    takenAt,
    gameId: picture.gameId,
    myPlayerId: picture.myPlayerId,
    myNation: picture.myNation,
    day: picture.day,
    timeScale: picture.timeScale,
    medianSpacing: picture.medianSpacing,
    sensorDegraded,
    atWar,
    zones,
    fronts,
    triggers: fresh,
    picture,
    alertKeys,
  };
}

export function alertsFromSnapshot(snap: WarWatchSnapshot): WarAlert[] {
  return snap.triggers.map((t) => ({
    level: t.level,
    line: t.line,
    escalateAll: !!t.escalateAll || t.kind === "MULTI_FRONT",
    trigger: t,
  }));
}

/** ETA string using coarse land speed + timeScale. */
export function etaHours(
  distance: number,
  timeScale: number | string | undefined,
): string {
  const scale =
    typeof timeScale === "number"
      ? timeScale
      : Number(String(timeScale).replace(/x/i, "")) || 1;
  const hours = distance / (LAND_SPEED * Math.max(scale, 0.25));
  if (!Number.isFinite(hours)) return "?";
  return `~${hours.toFixed(1)}h`;
}

export function formatWarBoard(snap: WarWatchSnapshot): string {
  const activeZones = snap.zones
    .filter((z) => z.level === "high" || z.level === "medium")
    .sort((a, b) => levelRank(a.level) - levelRank(b.level));
  const paper = (snap.picture.diplo?.atWarPaper ?? []).slice(0, 6);
  const fronts = activeZones.slice(0, 5).map((z) => {
    const f = snap.fronts.find((x) => x.playerId === z.playerId);
    const heat = z.level === "high" ? "🔴 HIGH" : "🟡 MED";
    const near =
      f?.nearestHostile?.province ||
      z.provinces.slice(0, 2).join(", ") ||
      "—";
    const own = f?.ownStrength ?? z.ownArmyIds.length;
    const host = f?.hostileStrength ?? z.hostileArmyIds.length;
    return `• *${z.nation}* — ${heat}\n  Near ${near} · us ${own} · them ${host}`;
  });
  const lines = [
    `🗺️ *War board* · day ${snap.day ?? "?"} · ${snap.myNation}`,
    `Live wars: *${snap.atWar.length}*`,
    "",
    fronts.length ? fronts.join("\n\n") : "_No active HIGH/MED fronts._",
  ];
  if (paper.length) {
    lines.push(
      "",
      `📜 Paper only (ignore ops): ${paper
        .map((p) => p.nation || p.name || "?")
        .join(", ")}`,
    );
  }
  if (snap.sensorDegraded) {
    lines.push("", "⚠️ Sensor degraded — picture may be incomplete.");
  }
  return lines.join("\n");
}

function levelRank(l: WatchLevel): number {
  return l === "high" ? 0 : l === "medium" ? 1 : 2;
}

export function unitStrength(armies: readonly WarArmyRow[]): number {
  return armies.reduce((s, a) => s + unitCount(a), 0);
}

export function filterByStandingOrders(
  triggers: WarTrigger[],
  goals: ReadonlyArray<{ key: string; value: string }>,
): WarTrigger[] {
  const noInvade = goals
    .filter((g) => g.key.startsWith("no-invade:"))
    .map((g) => g.key.slice("no-invade:".length).toLowerCase());
  const focus = goals
    .filter((g) => g.key.startsWith("focus:"))
    .map((g) => g.value.toLowerCase() || g.key.slice("focus:".length).toLowerCase());
  return triggers.filter((t) => {
    const nat = (t.nation || "").toLowerCase();
    const prov = (t.province || "").toLowerCase();
    if (noInvade.some((n) => nat.includes(n) || prov.includes(n))) {
      if (/push|invade|OPENED/i.test(t.line) && t.kind !== "IDLE_ON_HOT_FRONT") {
        return false;
      }
    }
    if (focus.length && t.level === "low") {
      if (!focus.some((f) => nat.includes(f) || prov.includes(f))) return false;
    }
    return true;
  });
}
