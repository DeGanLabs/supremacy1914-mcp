import { armyCommandCount } from "./display-format.js";
import type { PlayerGoal } from "./types.js";
import type { WarAlert, WarTrigger, WarWatchSnapshot } from "./war-types.js";
import {
  distrustNations,
  isShareMapFront,
  isTrustedPlayer,
} from "./war-trust.js";

const CRITICAL_KINDS = new Set<WarTrigger["kind"]>([
  "NEW_WAR",
  "SENSOR_DEGRADED",
  "MULTI_FRONT",
  "OWN_ARMY_CONTACT",
  "COASTAL_HOSTILE",
  "EMBARKED_NEAR",
  "FORCE_RATIO_FLIP",
]);

function holdDisengage(goals: ReadonlyArray<{ key: string; value: string }>): boolean {
  return goals.some(
    (g) =>
      g.key.startsWith("hold:") ||
      g.key.startsWith("no-invade:") ||
      /hold|disengage|screen/i.test(g.value),
  );
}

function focusNations(goals: ReadonlyArray<{ key: string; value: string }>): string[] {
  return goals
    .filter((g) => g.key.startsWith("focus:"))
    .map((g) => g.value.toLowerCase() || g.key.slice("focus:".length).toLowerCase());
}

/** Skip MED stack spam for trusted map-share neighbors. */
export function filterAlertsForTelegram(
  alerts: readonly WarAlert[],
  snap: WarWatchSnapshot,
  goals: ReadonlyArray<{ key: string; value: string }>,
): WarAlert[] {
  const picture = snap.picture;
  return alerts.filter((a) => {
    const t = a.trigger;
    if (t.kind === "NEW_VISIBLE_STACK") {
      const front = snap.fronts.find(
        (f) =>
          f.name === t.nation ||
          f.playerId === Number(String(t.nation).replace(/^p/, "")),
      );
      const pid =
        front?.playerId ??
        picture.foreignArmies?.find((x) => x.id === t.armyId)?.ownerId;
      if (pid != null && isTrustedPlayer(picture, pid, goals)) return false;
      if (front && isShareMapFront(front) && !isDistrustedFront(front, goals))
        return false;
    }
    if (t.kind === "IDLE_ON_HOT_FRONT") return false; // folded into digest
    if (t.kind === "OWN_ARMY_CONTACT" && !isSameHexContact(t, snap)) return false;
    return true;
  });
}

function isDistrustedFront(
  f: { name: string; playerId: number },
  goals: ReadonlyArray<{ key: string; value: string }>,
): boolean {
  const dist = distrustNations(goals);
  const nat = f.name.toLowerCase();
  return dist.some((d) => nat.includes(d));
}

function isSameHexContact(t: WarTrigger, snap: WarWatchSnapshot): boolean {
  if (!t.armyId) return false;
  const own = snap.picture.ownArmies?.find((a) => a.id === t.armyId);
  if (!own?.province) return false;
  const hostile = snap.picture.foreignArmies?.find(
    (a) =>
      a.atWar &&
      (a.province === own.province ||
        (own.pos &&
          a.pos &&
          Math.hypot(own.pos.x - a.pos.x, own.pos.y - a.pos.y) <
            (snap.medianSpacing ?? 40) * 0.35)),
  );
  return !!hostile;
}

export function pickCriticalPings(
  alerts: readonly WarAlert[],
  snap: WarWatchSnapshot,
  goals: ReadonlyArray<{ key: string; value: string }>,
): string[] {
  const filtered = filterAlertsForTelegram(alerts, snap, goals);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const a of filtered) {
    const k = a.trigger.kind;
    if (!CRITICAL_KINDS.has(k)) continue;
    if (k === "HOSTILE_NEAR") {
      const dMatch = a.line.match(/d=([\d.]+)/);
      const d = dMatch ? Number(dMatch[1]) : Infinity;
      const band = snap.picture.borderBand ?? (snap.medianSpacing ?? 50) * 1.5;
      if (d > band * 0.6) continue;
    }
    const human = humanizeCritical(a, snap, goals);
    if (!human || seen.has(human)) continue;
    seen.add(human);
    lines.push(human);
    if (lines.length >= 3) break;
  }
  return lines;
}

function humanizeCritical(
  a: WarAlert,
  _snap: WarWatchSnapshot,
  goals: ReadonlyArray<{ key: string; value: string }>,
): string {
  const t = a.trigger;
  const hold = holdDisengage(goals);
  switch (t.kind) {
    case "OWN_ARMY_CONTACT":
      return `⚡ Contact now — our stack at ${t.province ?? "?"} is in the same province as ${t.nation ?? "hostile"} troops. ${hold ? "Hold or pull back — not a push moment." : "Need a call."}`;
    case "COASTAL_HOSTILE":
      return `🚢 Coastal threat — ${t.nation ?? "enemy"} stack near ${t.province ?? "coast"}. 💥 Bombard or block before they land.`;
    case "EMBARKED_NEAR":
      return `🚢 Transport spotted — kill the landing stack before 🪖 infantry hits shore (${t.province ?? "?"}).`;
    case "HOSTILE_NEAR": {
      const m = t.line.match(/army (\d+).*@ ([^(]+).*d=([\d.]+)/i);
      if (m) {
        return `⚠️ ${t.nation ?? "Enemy"} army ${m[1]} near ${m[2].trim()} (${Math.round(Number(m[3]))} map units) — in range.`;
      }
      return `⚠️ ${t.nation ?? "Enemy"} stack closing on ${t.province ?? "border"} — in range now.`;
    }
    case "NEW_WAR":
      return `⚔️ New war opened — ${t.nation ?? "enemy"} at ${t.province ?? "?"}. Need a plan.`;
    case "SENSOR_DEGRADED":
      return "🔴 Bridge is up but the war picture is empty — re-paste browser-console.js and reconnect.";
    case "MULTI_FRONT":
      return `🔥 Multiple hot fronts (${t.nation ?? "several"}) — pick one priority.`;
    case "FORCE_RATIO_FLIP":
      return `⚖️ Force balance flipped on ${t.nation ?? "a front"} — check if we hold or trade space.`;
    default:
      return t.line.replace(/\/approve\?/gi, "").replace(/^HIGH /, "").trim();
  }
}

export function formatWatchDigest(
  snap: WarWatchSnapshot,
  goals: ReadonlyArray<{ key: string; value: string }>,
): string | null {
  const liveHigh = snap.zones.filter(
    (z) => z.level === "high" && snap.atWar.some((w) => w.id === z.playerId || z.tags.includes("AT_WAR")),
  );
  const shareMap = snap.fronts.filter(
    (f) => isShareMapFront(f) && !isDistrustedFront(f, goals),
  );
  const focus = focusNations(goals);

  const parts: string[] = [];
  parts.push(`📡 President — quick sitrep (day ${snap.day ?? "?"}).`);

  if (liveHigh.length) {
    for (const z of liveHigh.slice(0, 3)) {
      const provs = z.provinces.slice(0, 3).join("/") || z.nation;
      const idleCount = z.ownArmyIds.filter((id) => {
        const a = snap.picture.ownArmies?.find((x) => x.id === id);
        if (!a) return false;
        return a.idle || armyCommandCount(a) <= 0;
      }).length;
      const holdNote = holdDisengage(goals) && focus.some((f) => z.nation.toLowerCase().includes(f))
        ? " Standing order is hold/disengage — thin screen, no push."
        : "";
      parts.push(
        `⚔️ ${z.nation}: ${z.ownArmyIds.length} of ours at ${provs}, ${z.hostileArmyIds.length} hostile visible.${idleCount ? ` ${idleCount} 😴 idle.` : ""}${holdNote}`,
      );
    }
  } else {
    parts.push("✅ No live-war HIGH fronts right now.");
  }

  if (shareMap.length) {
    const names = shareMap
      .slice(0, 4)
      .map((f) => f.name)
      .join(", ");
    parts.push(
      `🤝 Trusted borders (${names}) — map-share allies. I'm not pulling troops off those lines.`,
    );
  }

  const dist = distrustNations(goals);
  if (dist.length) {
    parts.push(`Watch list: ${dist.join(", ")} — borders not fully trusted.`);
  }

  if (snap.sensorDegraded) {
    parts.push("Sensor degraded — picture may be incomplete.");
  }

  parts.push("Watching.");
  return parts.join("\n");
}

export interface WatchTelegramMessages {
  readonly digest: string | null;
  readonly critical: readonly string[];
}

export function buildWatchTelegramMessages(
  snap: WarWatchSnapshot,
  goals: ReadonlyArray<PlayerGoal>,
  alerts: readonly WarAlert[],
): WatchTelegramMessages {
  const filtered = filterAlertsForTelegram(alerts, snap, goals);
  const hasContent =
    filtered.length > 0 ||
    snap.zones.some((z) => z.level === "high") ||
    snap.triggers.length > 0;
  if (!hasContent) return { digest: null, critical: [] };

  return {
    digest: formatWatchDigest(snap, goals),
    critical: pickCriticalPings(alerts, snap, goals),
  };
}
