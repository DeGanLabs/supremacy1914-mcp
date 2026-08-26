import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type IntelSource =
  | "spy"
  | "scout"
  | "army_sight"
  | "naval_sight"
  | "air_sight"
  | "diplomacy"
  | "embargo"
  | "trade"
  | "war_declare"
  | "movement"
  | "province"
  | "building"
  | "war_picture";

export interface IntelEvent {
  id: string;
  timestamp: string;
  source: IntelSource;
  playerId?: number;
  nation?: string;
  location?: string;
  confidence: number;
  observed: string;
  inferred?: string;
  expires_at: string;
  payload?: Record<string, unknown>;
}

export interface FusedEstimate {
  location: string;
  nation?: string;
  summary: string;
  confidence: number;
  freshness: "high" | "medium" | "stale";
  sources: number;
  updatedAt: string;
}

const TTL_MS = {
  high: 3 * 60 * 1000,
  medium: 60 * 60 * 1000,
  stale: 8 * 60 * 60 * 1000,
};

function iid(): string {
  return `intel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function loadIntelEvents(
  rootDir: string,
): Promise<IntelEvent[]> {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, "intel.json"), "utf8"),
    ) as IntelEvent[];
  } catch {
    return [];
  }
}

export async function saveIntelEvents(
  rootDir: string,
  events: IntelEvent[],
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    path.join(rootDir, "intel.json"),
    JSON.stringify(events.slice(-200), null, 2),
    "utf8",
  );
}

export async function addIntelEvent(
  rootDir: string,
  partial: Omit<IntelEvent, "id" | "timestamp" | "expires_at"> & {
    ttlMs?: number;
  },
): Promise<IntelEvent> {
  const events = await loadIntelEvents(rootDir);
  const ttl = partial.ttlMs ?? TTL_MS.stale;
  const event: IntelEvent = {
    id: iid(),
    timestamp: new Date().toISOString(),
    source: partial.source,
    playerId: partial.playerId,
    nation: partial.nation,
    location: partial.location,
    confidence: Math.min(1, Math.max(0, partial.confidence)),
    observed: partial.observed,
    inferred: partial.inferred,
    expires_at: new Date(Date.now() + ttl).toISOString(),
    payload: partial.payload,
  };
  events.push(event);
  await saveIntelEvents(rootDir, events);
  return event;
}

export function freshnessOf(
  event: IntelEvent,
  now = Date.now(),
): "high" | "medium" | "stale" {
  const age = now - Date.parse(event.timestamp);
  if (age <= TTL_MS.high) return "high";
  if (age <= TTL_MS.medium) return "medium";
  return "stale";
}

/** Fuse overlapping location reports into a single estimate. */
export function fuseIntel(
  events: readonly IntelEvent[],
  now = Date.now(),
): FusedEstimate[] {
  const active = events.filter((e) => Date.parse(e.expires_at) > now);
  const byLoc = new Map<string, IntelEvent[]>();
  for (const e of active) {
    const key = (e.location ?? "unknown").toLowerCase();
    const list = byLoc.get(key) ?? [];
    list.push(e);
    byLoc.set(key, list);
  }
  const out: FusedEstimate[] = [];
  for (const [loc, list] of byLoc) {
    const weight = list.reduce((s, e) => s + e.confidence, 0);
    const confidence = Math.min(
      0.99,
      weight / Math.max(1, list.length) + 0.05 * (list.length - 1),
    );
    const freshest = [...list].sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    )[0]!;
    const fresh = freshnessOf(freshest, now);
    if (fresh === "stale" && list.length === 1) {
      // Keep but mark stale — War should know "we knew"
    }
    out.push({
      location: freshest.location ?? loc,
      nation: freshest.nation,
      summary: list.map((e) => e.observed).slice(0, 3).join(" · "),
      confidence: Number(confidence.toFixed(2)),
      freshness: fresh,
      sources: list.length,
      updatedAt: freshest.timestamp,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

export function formatIntelBrief(
  events: readonly IntelEvent[],
  now = Date.now(),
): string {
  const fused = fuseIntel(events, now);
  if (!fused.length) return "Intel: no fresh fused observations.";
  const lines = ["Intel (known vs knew):"];
  for (const f of fused.slice(0, 8)) {
    const tag =
      f.freshness === "high"
        ? "KNOW"
        : f.freshness === "medium"
          ? "RECENT"
          : "KNEW";
    lines.push(
      `[${tag} c=${f.confidence}] ${f.location}${f.nation ? ` (${f.nation})` : ""}: ${f.summary}`,
    );
  }
  return lines.join("\n");
}

/** Ingest hostile armies from war picture as sightings. */
export async function ingestWarPictureSightings(
  rootDir: string,
  foreignArmies: ReadonlyArray<{
    id?: number;
    ownerId?: number;
    nation?: string;
    province?: string | null;
    onSea?: boolean;
    units?: ReadonlyArray<{ name?: string; size?: number }>;
    atWar?: boolean;
  }>,
): Promise<number> {
  let n = 0;
  for (const a of foreignArmies.slice(0, 30)) {
    if (!a.atWar) continue;
    const units = (a.units ?? [])
      .map((u) => `${u.size ?? "?"}×${u.name ?? "?"}`)
      .join("+");
    await addIntelEvent(rootDir, {
      source: a.onSea ? "naval_sight" : "army_sight",
      playerId: a.ownerId,
      nation: a.nation,
      location: a.province ?? (a.onSea ? "at sea" : "unknown"),
      confidence: a.units?.length ? 0.9 : 0.6,
      observed: `army ${a.id ?? "?"} ${units || "fog"}`,
      ttlMs: TTL_MS.medium,
    });
    n++;
  }
  return n;
}
