import type { WarPictureRaw, WarWatchSnapshot } from "./war-types.js";
import { etaHours } from "./war-watch.js";
import { armyCommandCount, armyWaitSeconds, etaFromWaitSeconds } from "./display-format.js";
import { formatTrustedBlock, trustStandingBlock } from "./war-trust.js";

/** Compact briefing for LLM. */
export function formatWarBriefing(
  snap: WarWatchSnapshot | null,
  picture?: WarPictureRaw | null,
  maxChars = 4500,
): string {
  const pic = picture ?? snap?.picture;
  if (!snap && !pic) return "(no war picture yet)";

  const lines: string[] = [];
  const s = snap;
  const p = pic!;

  lines.push(
    `WAR PICTURE game=${p.gameId} me=${p.myNation}#${p.myPlayerId} day=${p.day ?? "?"} scale=${p.timeScale ?? "?"} taken=${s?.takenAt ?? p.takenAt ?? "?"}`,
  );
  if (p.sensorDegraded || s?.sensorDegraded) {
    lines.push("SENSOR_DEGRADED — armies/provinces empty");
  }

  const wars = p.diplo?.atWar ?? s?.atWar ?? [];
  const paper = p.diplo?.atWarPaper ?? [];
  lines.push(
    `WARS live (${wars.length}): ${
      wars
        .map(
          (w) =>
            `${w.nation || w.name}#${w.id}[${w.status ?? "active"} prov=${w.provincesKnown ?? "?"}]`,
        )
        .join(", ") || "none"
    }`,
  );
  if (paper.length) {
    lines.push(
      `WARS paper/defeated/ghost (${paper.length}): ${paper
        .slice(0, 10)
        .map((w) => `${w.nation || w.name}[${w.status || "defeated"}]`)
        .join(", ")} — ignore for ops`,
    );
  }

  const trusted = formatTrustedBlock(p);
  if (trusted.length) {
    lines.push("TRUSTED (do not strip these borders):");
    for (const t of trusted) lines.push(`  ${t}`);
  }

  const zones = s?.zones ?? [];
  const high = zones.filter((z) => z.level === "high").slice(0, 6);
  const med = zones.filter((z) => z.level === "medium").slice(0, 4);
  if (high.length) {
    lines.push("HIGH:");
    for (const z of high) {
      lines.push(
        `  - ${z.nation}: ${z.provinces.slice(0, 4).join("/") || "?"} | own[${z.ownArmyIds.join(",")}] hostile[${z.hostileArmyIds.slice(0, 6).join(",")}] | ${z.note}`,
      );
    }
  } else {
    lines.push("HIGH: (none)");
  }
  if (med.length) {
    lines.push("MED:");
    for (const z of med) {
      lines.push(
        `  - ${z.nation}: ${z.provinces.slice(0, 3).join("/") || "?"} | ${z.note}`,
      );
    }
  }

  const fronts = p.fronts ?? s?.fronts ?? [];
  if (fronts.length) {
    lines.push("FRONTS:");
    for (const f of fronts.slice(0, 8)) {
      const nh = f.nearestHostile;
      const eta = (() => {
        const nearest = nh
          ? (p.foreignArmies ?? []).find((a) => a.id === nh.armyId)
          : undefined;
        const wait = nearest ? armyWaitSeconds(nearest) : null;
        if (wait != null) return etaFromWaitSeconds(wait, p.timeScale);
        if (nh && Number.isFinite(nh.distance)) return etaHours(nh.distance, p.timeScale);
        return "?";
      })();
      lines.push(
        `  - ${f.name} [${f.level}] war=${!!f.atWar} ownStr=${f.ownStrength ?? f.ownArmyIds.length} hostileStr=${f.hostileStrength ?? f.hostileArmyIds.length} nearest=${nh ? `${nh.armyId}@${nh.province} d=${nh.distance} eta=${eta}` : "—"}`,
      );
    }
  }

  const own = p.ownArmies ?? [];
  lines.push(`OWN ARMIES (${own.length}):`);
  for (const a of own.slice(0, 25)) {
    const units = (a.units || [])
      .map((u) => `${u.size ?? "?"}×${u.name ?? "?"}`)
      .join(",") || "?";
    const cmds = armyCommandCount(a);
    const wait = armyWaitSeconds(a);
    const march =
      a.idle || cmds <= 0
        ? "IDLE"
        : wait != null
          ? `ETA ${etaFromWaitSeconds(wait, p.timeScale)}`
          : `MARCH q${cmds}`;
    lines.push(
      `  army ${a.id} @ ${a.province ?? "?"} ${a.onSea ? "SEA" : "LAND"} ${march} mor ${a.morale ?? "?"}${a.currentSpeed != null ? ` spd ${Math.round(Number(a.currentSpeed))}` : ""} [${units}]`,
    );
  }

  const ownProv = p.ownProvinces ?? [];
  if (ownProv.length) {
    const lowMorale = ownProv
      .filter((x) => x.morale != null && Number(x.morale) < 55)
      .slice(0, 8);
    lines.push(
      `OWN PROVINCES (${ownProv.length})${lowMorale.length ? ` low-morale: ${lowMorale.map((x) => `${x.name}:${x.morale}`).join(", ")}` : ""}`,
    );
  }
  const foreign = p.foreignArmies ?? [];
  lines.push(`FOREIGN (capped ${foreign.length}):`);
  for (const a of foreign.slice(0, 20)) {
    lines.push(
      `  army ${a.id} ${a.nation || a.owner} @ ${a.province ?? "?"} ${a.onSea ? "SEA" : "LAND"} war=${!!a.atWar} vis=${a.detailsVisible !== false} spy=${a.spyRevealed ?? "—"} dBorder=${a.distToBorder ?? "?"} dSelf=${a.distToSelf ?? "?"} [${(a.units || []).map((u: { size?: number; name?: string }) => `${u.size ?? "?"}×${u.name ?? "?"}`).join(",") || "fog"}]`,
    );
  }

  const spies = p.spies;
  if (spies) {
    lines.push(
      `SPIES agents=${spies.agents?.length ?? 0} fog=${spies.fog?.length ?? 0}`,
    );
    for (const ag of (spies.agents || []).slice(0, 8)) {
      lines.push(
        `  ${ag.province ?? "?"} · ${ag.mission ?? "?"} mor ${ag.morale ?? "?"} cost ${ag.dailyCosts ?? "?"}`,
      );
    }
    for (const f of (spies.fog || []).slice(0, 6)) {
      lines.push(`  FOG war-neighbor ${f.nation ?? f.playerId}: ${f.reason}`);
    }
  }

  const heroes = p.heroes as
    | {
        deployedOnMap?: Array<{
          armyId?: number;
          province?: string;
          heroes?: Array<{ name?: string; level?: number; rarity?: string }>;
        }>;
      }
    | undefined;
  if (heroes?.deployedOnMap?.length) {
    lines.push("HEROES:");
    for (const h of heroes.deployedOnMap.slice(0, 10)) {
      lines.push(
        `  army ${h.armyId} @ ${h.province}: ${(h.heroes || []).map((x) => `${x.name}${x.level != null ? ` L${x.level}` : ""}${x.rarity ? ` (${x.rarity})` : ""}`).join(", ")}`,
      );
    }
  }

  if (s?.triggers?.length) {
    lines.push("LAST TRIGGERS:");
    for (const t of s.triggers.slice(0, 8)) {
      lines.push(`  [${t.kind}] ${t.line}`);
    }
  }

  const lowCount = zones.filter((z) => z.level === "low").length;
  if (lowCount) lines.push(`LOW zones: ${lowCount} (omitted)`);

  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 20)}\n…(truncated)`;
  return out;
}

/**
 * Player-facing sitrep when the LLM fails JSON — prefer fronts/zones matching the question.
 */
export function formatWarSituationAnswer(
  snap: {
    readonly day?: number | null;
    readonly fronts?: ReadonlyArray<{
      readonly name: string;
      readonly atWar?: boolean;
      readonly level?: string;
      readonly ownArmyIds?: readonly number[];
      readonly hostileArmyIds?: readonly number[];
      readonly ownStrength?: number;
      readonly hostileStrength?: number;
      readonly borderProvinces?: readonly string[];
      readonly nearestHostile?: {
        armyId?: number;
        province?: string | null;
        distance?: number;
      } | null;
    }>;
    readonly zones?: ReadonlyArray<{
      readonly nation: string;
      readonly level?: string;
      readonly provinces?: readonly string[];
      readonly ownArmyIds?: readonly number[];
      readonly hostileArmyIds?: readonly number[];
      readonly note?: string;
    }>;
    readonly atWar?: ReadonlyArray<{ nation?: string; name?: string }>;
    readonly picture?: {
      readonly ownArmies?: ReadonlyArray<{
        readonly id?: number;
        readonly idle?: boolean;
        readonly province?: string | null;
      }>;
    };
  } | null,
  question: string,
  maxChars = 900,
): string | null {
  if (!snap) return null;
  const q = question.toLowerCase();
  const fronts = snap.fronts ?? [];
  const zones = snap.zones ?? [];
  const own = snap.picture?.ownArmies ?? [];

  const mentioned = fronts.filter((f) => {
    const nat = f.name.toLowerCase();
    return nat.length >= 3 && q.includes(nat);
  });
  const pool =
    mentioned.length > 0
      ? mentioned
      : fronts.filter((f) => f.atWar).slice(0, 3);
  if (!pool.length && !zones.length) return null;

  const parts: string[] = [];
  if (snap.day != null) parts.push(`Day ${snap.day}.`);

  for (const f of pool.slice(0, 3)) {
    const z = zones.find(
      (x) => x.nation.toLowerCase() === f.name.toLowerCase(),
    );
    const provs = (
      z?.provinces?.slice(0, 3) ??
      f.borderProvinces?.slice(0, 3) ??
      []
    ).join(", ");
    const ownN = f.ownArmyIds?.length ?? z?.ownArmyIds?.length ?? 0;
    const hostN = f.hostileArmyIds?.length ?? z?.hostileArmyIds?.length ?? 0;
    const idle = (f.ownArmyIds ?? z?.ownArmyIds ?? []).filter((id) => {
      const a = own.find((x) => x.id === id);
      return a?.idle;
    }).length;
    const nh = f.nearestHostile;
    const near =
      nh?.province != null
        ? ` Nearest hostile @ ${nh.province}${nh.distance != null ? ` (d=${Math.round(nh.distance)})` : ""}.`
        : z?.note
          ? ` ${z.note}.`
          : "";
    const str =
      f.ownStrength != null && f.hostileStrength != null
        ? ` Force ~${f.ownStrength} vs ~${f.hostileStrength}.`
        : "";
    parts.push(
      `${f.name}${f.atWar ? " (war)" : ""}: ${ownN} of ours near ${provs || "?"}, ${hostN} hostile visible${idle ? `, ${idle} idle` : ""}.${str}${near}`,
    );
  }

  if (!parts.length) return null;
  let out = parts.join(" ");
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1)}…`;
  return out;
}

/** Best-effort sitrep from the already-formatted war briefing text. */
export function formatWarSituationFromBrief(
  brief: string | undefined,
  question: string,
  maxChars = 900,
): string | null {
  if (!brief?.trim()) return null;
  const q = question.toLowerCase();
  const frontLines = brief
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^- .+\s\[(high|medium|low)\]/i.test(l));
  const picked = frontLines.filter((l) => {
    const name = l.replace(/^- /, "").split("[")[0]?.trim().toLowerCase() ?? "";
    return name.length >= 3 && q.includes(name);
  });
  const use = picked.length ? picked : frontLines.filter((l) => /war=true/i.test(l)).slice(0, 3);
  if (!use.length) {
    // Fall back to HIGH zone lines
    const high = brief
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^- .+:/.test(l) && !/\[(high|medium|low)\]/i.test(l));
    const zh = high.filter((l) => {
      const name = l.replace(/^- /, "").split(":")[0]?.trim().toLowerCase() ?? "";
      return name.length >= 3 && q.includes(name);
    });
    if (!zh.length) return brief.slice(0, maxChars);
    return zh
      .slice(0, 2)
      .map((l) => l.replace(/^- /, "").replace(/\s*\|\s*/g, " · "))
      .join(" ")
      .slice(0, maxChars);
  }
  const parts = use.slice(0, 3).map((l) => {
    const m = l.match(
      /^- (.+?)\s\[(\w+)\]\s+war=(\S+)\s+ownStr=(\S+)\s+hostileStr=(\S+)\s+nearest=(\S+)/i,
    );
    if (!m) return l.replace(/^- /, "");
    const [, name, level, war, ownStr, hostStr, nearest] = m;
    const near =
      nearest && nearest !== "—"
        ? ` Nearest ${nearest.replace(/d=([\d.]+)/, (_, d) => `d=${Math.round(Number(d))}`)}.`
        : "";
    return `${name} [${level}${war === "true" ? ", war" : ""}]: force ~${ownStr} vs ~${hostStr}.${near}`;
  });
  return parts.join(" ").slice(0, maxChars);
}

export function standingOrdersBlock(
  goals: ReadonlyArray<{ key: string; value: string }>,
): string {
  const warGoals = goals.filter(
    (g) =>
      g.key.startsWith("hold:") ||
      g.key.startsWith("no-invade:") ||
      g.key.startsWith("focus:") ||
      g.key.startsWith("war:") ||
      g.key.startsWith("distrust:"),
  );
  const trust = trustStandingBlock(goals);
  if (!warGoals.length) return trust;
  return `${trust}\n${warGoals.map((g) => `- ${g.key}: ${g.value}`).join("\n")}`;
}
