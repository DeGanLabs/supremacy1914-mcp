import type { WarArmyRow, WarPictureRaw } from "./war-types.js";

export function armyCommandCount(army: WarArmyRow): number {
  if (typeof army.commands === "number") return army.commands;
  if (Array.isArray(army.commands)) return army.commands.length;
  return army.commandCount ?? 0;
}

export function armyWaitSeconds(army: WarArmyRow): number | null {
  if (typeof army.waitSeconds === "number" && Number.isFinite(army.waitSeconds)) {
    return army.waitSeconds;
  }
  if (!Array.isArray(army.commands)) return null;
  let sum = 0;
  let any = false;
  for (const c of army.commands) {
    const w = Number(c.waitSeconds);
    if (Number.isFinite(w) && w > 0) {
      sum += w;
      any = true;
    }
  }
  return any ? sum : null;
}

export function unitCount(army: WarArmyRow): number {
  return (army.units ?? []).reduce((s, u) => s + (Number(u.size) || 0), 0);
}

export function hoursToStockout(amount: number, rate: number): number | null {
  if (!(rate < 0) || !(amount > 0)) return null;
  const hours = amount / Math.abs(rate);
  return Number.isFinite(hours) ? hours : null;
}

export function formatGameTimestamp(ts: number | undefined | null): string {
  if (ts == null || !Number.isFinite(Number(ts)) || Number(ts) <= 0) return "?";
  const n = Number(ts);
  const ms = n < 1e12 ? n * 1000 : n;
  try {
    return `${new Date(ms).toISOString().slice(11, 19)}Z`;
  } catch {
    return "?";
  }
}

export function formatSpyRoster(spies: unknown): string {
  if (!spies || typeof spies !== "object") return "🕵️ no spy dump";
  const s = spies as {
    totals?: { all?: number; idle?: number; onMission?: number; dailyCosts?: number };
    agents?: Array<{
      province?: string | null;
      mission?: string;
      morale?: number;
      dailyCosts?: number;
      kills?: number;
      size?: number;
      onSea?: boolean;
      atAirfield?: boolean;
      provinceOwner?: number;
    }>;
    latestIntel?: {
      day?: number;
      jobs?: Array<{
        jobName?: string;
        description?: string;
        opponentId?: number;
        amount?: number;
        countryWide?: boolean;
      }>;
    };
    fog?: Array<{ nation?: string; playerId?: number; reason?: string }>;
  };
  const lines = [
    `🕵️ Spies ${s.totals?.onMission ?? "?"}/${s.totals?.all ?? "?"} on mission · idle ${s.totals?.idle ?? "?"} · cost ${s.totals?.dailyCosts ?? "?"}`,
  ];
  for (const a of (s.agents ?? []).slice(0, 20)) {
    const flags = [a.onSea ? "SEA" : null, a.atAirfield ? "AIR" : null]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `  ${a.province ?? "?"} · ${a.mission ?? "?"} · mor ${a.morale ?? "?"} · ${a.dailyCosts ?? "?"}g${a.kills != null ? ` · k${a.kills}` : ""}${flags ? ` · ${flags}` : ""}`,
    );
  }
  const jobs = s.latestIntel?.jobs ?? [];
  if (jobs.length) {
    lines.push(`Latest jobs (day ${s.latestIntel?.day ?? "?"}):`);
    for (const j of jobs.slice(0, 8)) {
      lines.push(
        `  ${j.jobName ?? "job"} vs p${j.opponentId ?? "?"} amt=${j.amount ?? "?"} ${j.countryWide ? "country" : ""} — ${(j.description ?? "").slice(0, 80)}`,
      );
    }
  }
  for (const f of (s.fog ?? []).slice(0, 6)) {
    lines.push(`  FOG ${f.nation ?? f.playerId}: ${f.reason}`);
  }
  return lines.join("\n");
}

export function formatRelationsTable(diplo: unknown): string {
  if (!diplo || typeof diplo !== "object") return "🤝 no relations dump";
  const d = diplo as {
    atWar?: Array<{ id?: number; nation?: string; name?: string; relation?: number; label?: string }>;
    rightOfWay?: Array<{ id?: number; nation?: string; name?: string; relation?: number; label?: string }>;
    shareMapOrBetter?: Array<{ id?: number; nation?: string; name?: string; relation?: number; label?: string }>;
    nonPeace?: Array<{
      id?: number;
      nation?: string;
      name?: string;
      relation?: number;
      label?: string;
      war?: boolean;
      row?: boolean;
      canSeeArmies?: boolean;
      canUseAirfields?: boolean;
      honorPeriodEnd?: number;
    }>;
    rows?: Array<{
      id?: number;
      nation?: string;
      name?: string;
      relation?: number;
      label?: string;
      war?: boolean;
      row?: boolean;
      canSeeArmies?: boolean;
      canUseAirfields?: boolean;
    }>;
  };
  const rows = (d.rows ?? d.nonPeace ?? []).slice(0, 25);
  const lines = ["🤝 Relations (int · label · flags)"];
  for (const r of rows) {
    const flags = [
      r.war ? "WAR" : null,
      r.row ? "RoW" : null,
      r.canSeeArmies ? "see" : null,
      r.canUseAirfields ? "air" : null,
    ]
      .filter(Boolean)
      .join(",");
    lines.push(
      `  ${r.nation || r.name || r.id} · ${r.relation ?? "?"} ${r.label ?? ""} ${flags}`.trim(),
    );
  }
  if (!rows.length) {
    lines.push(
      `  wars: ${(d.atWar ?? []).map((x) => x.nation || x.name).join(", ") || "none"}`,
    );
    lines.push(
      `  RoW: ${(d.rightOfWay ?? []).map((x) => x.nation || x.name).join(", ") || "none"}`,
    );
    lines.push(
      `  share-map+: ${(d.shareMapOrBetter ?? []).map((x) => x.nation || x.name).join(", ") || "none"}`,
    );
  }
  return lines.join("\n");
}

export function formatArmyBoard(
  picture: WarPictureRaw | null | undefined,
  timeScale?: number | string,
): string {
  const armies = picture?.ownArmies ?? [];
  if (!armies.length) return "🪖 no own armies in war picture";
  const lines = [`🪖 Own armies (${armies.length})`];
  for (const a of armies.slice(0, 25)) {
    const units =
      (a.units ?? [])
        .map((u) => `${u.size ?? "?"}×${(u.name ?? "?").replace(/infantry/i, "inf")}`)
        .join(",") || "?";
    const cmds = armyCommandCount(a);
    const wait = armyWaitSeconds(a);
    const eta =
      wait != null
        ? etaFromWaitSeconds(wait, timeScale ?? picture?.timeScale)
        : cmds > 0
          ? `q${cmds}`
          : "IDLE";
    const speed =
      a.currentSpeed != null
        ? ` spd ${Math.round(Number(a.currentSpeed))}`
        : a.speed != null
          ? ` spd ${Math.round(Number(a.speed))}`
          : "";
    lines.push(
      `  ${a.id} @ ${a.province ?? "?"} ${a.onSea ? "SEA" : "LAND"} ${eta} mor ${a.morale ?? "?"}${speed} [${units}]`,
    );
  }
  return lines.join("\n");
}

export function etaFromWaitSeconds(
  waitSeconds: number,
  timeScale: number | string | undefined,
): string {
  const scale =
    typeof timeScale === "number"
      ? timeScale
      : Number(String(timeScale ?? "1").replace(/x/i, "")) || 1;
  const hours = waitSeconds / 3600 / Math.max(scale, 0.25);
  if (!Number.isFinite(hours)) return "?";
  if (hours < 0.1) return `${Math.round(waitSeconds / Math.max(scale, 0.25))}s`;
  return `${hours.toFixed(1)}h`;
}

export function formatStatsStrip(stats: unknown): string {
  if (!stats || typeof stats !== "object") return "📊 no stats dump";
  const s = stats as {
    gameInfo?: {
      day?: number;
      remaining?: string;
      remainingDayLabel?: string;
      speed?: string;
      vpPercent?: number;
      victoryPercent?: number;
      players?: number;
      numberOfPlayers?: number;
    };
    combat?: { kills?: number; deaths?: number; provincesCaptured?: number; provincesLost?: number };
    provinces?: {
      count?: number;
      averageMorale?: number;
      provinces?: Array<{
        name?: string;
        morale?: number;
        revoltChance?: number;
        mainProduction?: number;
      }>;
      list?: Array<{
        name?: string;
        morale?: number;
        revoltChance?: number;
        mainProduction?: number;
      }>;
    };
    selfRank?: { rankingOrder?: number; name?: string };
    top10?: Array<{ rankingOrder?: number; nationName?: string; name?: string }>;
  };
  const gi = s.gameInfo ?? {};
  const c = s.combat ?? {};
  const kd =
    c.deaths && c.deaths > 0 && c.kills != null
      ? (c.kills / c.deaths).toFixed(2)
      : String(c.kills ?? "?");
  const lines = [
    `📊 Day ${gi.day ?? "?"} · ${gi.remaining ?? gi.remainingDayLabel ?? "?"} · ${gi.speed ?? "?"}`,
    `VP ${gi.vpPercent ?? gi.victoryPercent ?? "?"}% · rank ${s.selfRank?.rankingOrder ?? "?"} · K/D ${kd} (${c.kills ?? "?"}/${c.deaths ?? "?"}) · net prov ${(c.provincesCaptured ?? 0) - (c.provincesLost ?? 0)}`,
    `Provinces ${s.provinces?.count ?? "?"} · avg morale ${s.provinces?.averageMorale ?? "?"}`,
  ];
  const risky = (s.provinces?.provinces ?? s.provinces?.list ?? [])
    .filter((p) => (p.revoltChance ?? 0) > 0.05 || (p.morale ?? 100) < 50)
    .slice(0, 8);
  for (const p of risky) {
    lines.push(
      `  ${p.name} mor ${p.morale ?? "?"} revolt ${p.revoltChance ?? "?"} prod ${p.mainProduction ?? "?"}`,
    );
  }
  return lines.join("\n");
}

export function formatEconomyStrip(resources: unknown): string {
  const bag =
    resources && typeof resources === "object" && !Array.isArray(resources)
      ? (resources as { money?: number; resources?: unknown[] })
      : null;
  const list = Array.isArray(resources)
    ? resources
    : Array.isArray(bag?.resources)
      ? bag.resources
      : [];
  const money = Number(bag?.money);
  if (!list.length && !Number.isFinite(money)) return "💰 no resources";
  const head = Number.isFinite(money)
    ? `💰 Economy 💵 ${Math.round(money)} (stock · rate · hours-to-zero)`
    : "💰 Economy (stock · rate · hours-to-zero)";
  const lines = [head];
  for (const raw of list.slice(0, 12)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as {
      name?: string;
      amount?: number;
      rate?: number;
      hoursToZero?: number | null;
    };
    const hrs =
      r.hoursToZero != null && Number.isFinite(Number(r.hoursToZero))
        ? Number(r.hoursToZero)
        : hoursToStockout(Number(r.amount) || 0, Number(r.rate) || 0);
    const rate = Number(r.rate) || 0;
    const sign = rate > 0 ? "+" : "";
    lines.push(
      `  ${r.name ?? "?"} ${Math.round(Number(r.amount) || 0)} · ${sign}${Math.round(rate)}${hrs != null ? ` · ${hrs.toFixed(1)}h` : ""}`,
    );
  }
  return lines.join("\n");
}
