import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT =
  process.env.S1914_HISTORY_DIR?.trim() ||
  path.join(process.env.S1914_MCP_PROFILE?.trim() || "/data/profile", "..", "history");

type Snap = {
  at: string;
  gameId: number;
  bundle: Record<string, unknown>;
};

function dir(gameId: number): string {
  return path.join(ROOT, String(gameId));
}

function ensure(gameId: number): string {
  const d = dir(gameId);
  mkdirSync(path.join(d, "snapshots"), { recursive: true });
  return d;
}

function eventsPath(gameId: number): string {
  return path.join(ensure(gameId), "events.jsonl");
}

export function appendHistoryEvent(
  gameId: number,
  kind: string,
  detail: unknown,
): void {
  const line =
    JSON.stringify({ at: new Date().toISOString(), kind, detail }) + "\n";
  const p = eventsPath(gameId);
  let prev = "";
  try {
    prev = readFileSync(p, "utf8");
  } catch {
    prev = "";
  }
  const rows = (prev + line).split("\n").filter(Boolean);
  const trimmed = rows.length > 300 ? rows.slice(rows.length - 150) : rows;
  writeFileSync(p, trimmed.join("\n") + "\n");
}

function asArr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function digest(bundle: Record<string, unknown>): string {
  try {
    return JSON.stringify({
      provinces: asArr(bundle.provinces).map((p) => ({
        id: p.id,
        resourceType: p.resourceType,
        buildings: Array.isArray(p.buildings)
          ? (p.buildings as { name?: string; enabled?: unknown }[]).map((b) => ({
              name: b.name,
              enabled: b.enabled,
            }))
          : null,
      })),
      armies: bundle.armies,
      resources: bundle.resources,
      wars: bundle.wars,
    });
  } catch {
    return "";
  }
}

export function takeSnapshot(gameId: number, live: unknown): {
  ok: boolean;
  skipped?: boolean;
  path?: string;
  at: string;
} {
  const d = ensure(gameId);
  const bundle =
    live && typeof live === "object" ? (live as Record<string, unknown>) : { raw: live };
  const snaps = path.join(d, "snapshots");
  const files = readdirSync(snaps).filter((f) => f.endsWith(".json")).sort();
  const lastName = files[files.length - 1];
  if (lastName) {
    try {
      const prev = JSON.parse(readFileSync(path.join(snaps, lastName), "utf8")) as Snap;
      if (digest(prev.bundle) === digest(bundle)) {
        return { ok: true, skipped: true, at: prev.at };
      }
      appendHistoryEvent(gameId, "diff", diffBundles(prev.bundle, bundle));
    } catch {
      /* write anyway */
    }
  }
  const at = new Date().toISOString();
  const file = path.join(snaps, at.replace(/[:.]/g, "-") + ".json");
  const snap: Snap = { at, gameId, bundle };
  writeFileSync(file, JSON.stringify(snap));
  appendHistoryEvent(gameId, "snapshot", { at, file: path.basename(file) });
  return { ok: true, path: file, at };
}

function buildingSig(p: Record<string, unknown>): string {
  if (!Array.isArray(p.buildings)) return "";
  return (p.buildings as { name?: string; enabled?: unknown }[])
    .map((b) => `${b.name}:${String(b.enabled)}`)
    .join("|");
}

function diffBundles(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const prevP = new Map(asArr(prev.provinces).map((p) => [String(p.id), p]));
  const nextP = new Map(asArr(next.provinces).map((p) => [String(p.id), p]));
  const lost: unknown[] = [];
  const gained: unknown[] = [];
  for (const [id, p] of prevP) {
    if (!nextP.has(id)) lost.push({ id, name: p.name });
  }
  const resourceTypeChanges: unknown[] = [];
  const buildingChanges: unknown[] = [];
  for (const [id, p] of nextP) {
    if (!prevP.has(id)) gained.push({ id, name: p.name });
    const old = prevP.get(id);
    if (!old) continue;
    if (old.resourceType && p.resourceType && old.resourceType !== p.resourceType) {
      resourceTypeChanges.push({
        id,
        name: p.name,
        from: old.resourceType,
        to: p.resourceType,
      });
    }
    const fromB = buildingSig(old);
    const toB = buildingSig(p);
    if (fromB && toB && fromB !== toB) {
      buildingChanges.push({ id, name: p.name, from: fromB, to: toB });
    }
  }
  const prevA = new Map(asArr(prev.armies).map((a) => [String(a.id), a]));
  const armyMoves: unknown[] = [];
  for (const a of asArr(next.armies)) {
    const old = prevA.get(String(a.id));
    if (!old) continue;
    const op = old.pos as { x?: number; y?: number } | undefined;
    const np = a.pos as { x?: number; y?: number } | undefined;
    if (op && np && (op.x !== np.x || op.y !== np.y)) {
      armyMoves.push({ id: a.id, from: op, to: np, province: a.province });
    }
  }
  const resourceDeltas: unknown[] = [];
  const pr = asArr(prev.resources);
  const nr = asArr(next.resources);
  for (const r of nr) {
    const old = pr.find((x) => x.id === r.id || x.name === r.name);
    if (!old) continue;
    if (old.amount !== r.amount) {
      resourceDeltas.push({
        name: r.name,
        from: old.amount,
        to: r.amount,
      });
    }
  }
  const prevWars = new Set(asArr(prev.wars).map((w) => JSON.stringify(w)));
  const newThreats = asArr(next.wars).filter((w) => !prevWars.has(JSON.stringify(w)));
  return {
    lost,
    gained,
    resourceTypeChanges,
    buildingChanges,
    armyMoves,
    resourceDeltas,
    newThreats,
  };
}

export function listHistory(gameId: number, limit: number): {
  gameId: number;
  events: unknown[];
} {
  let raw = "";
  try {
    raw = readFileSync(eventsPath(gameId), "utf8");
  } catch {
    return { gameId, events: [] };
  }
  const rows = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const n = Math.max(1, Math.min(150, limit));
  return { gameId, events: rows.slice(-n) };
}

export function campaignDiff(gameId: number, since?: string): Record<string, unknown> {
  const snaps = path.join(ensure(gameId), "snapshots");
  let files: string[] = [];
  try {
    files = readdirSync(snaps).filter((f) => f.endsWith(".json")).sort();
  } catch {
    files = [];
  }
  if (files.length < 1) {
    return { ok: false, error: "no snapshots yet — call campaign_snapshot first" };
  }
  const load = (name: string) =>
    JSON.parse(readFileSync(path.join(snaps, name), "utf8")) as Snap;
  const latest = load(files[files.length - 1]!);
  let base = load(files[0]!);
  if (since) {
    const t = Date.parse(since);
    const candidates = files
      .map((f) => load(f))
      .filter((s) => Date.parse(s.at) <= t);
    if (candidates.length) base = candidates[candidates.length - 1]!;
  } else if (files.length >= 2) {
    base = load(files[files.length - 2]!);
  }
  return {
    ok: true,
    from: base.at,
    to: latest.at,
    ...diffBundles(base.bundle, latest.bundle),
  };
}

export function startCampaignAutosnap(
  isBusy: () => boolean,
  snap: () => Promise<unknown>,
): void {
  const ms = Number(process.env.S1914_HISTORY_MS ?? 480_000);
  if (!Number.isFinite(ms) || ms < 60_000) return;
  setInterval(() => {
    if (isBusy()) return;
    void snap().catch(() => undefined);
  }, ms);
}
