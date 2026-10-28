/**
 * Short-lived map screenshot store (PNG + JSON meta).
 * Served at GET /shots/:id.png — no Bearer (unguessable id + TTL).
 */
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ShotMeta {
  id: string;
  expiresAt: string;
  ttlSec: number;
  gameId: number | null;
  focus: Record<string, unknown> | null;
  caption: string | null;
  bytes: number;
  createdAt: string;
}

export interface ShotWriteInput {
  png: Buffer;
  ttlSec?: number;
  gameId?: number | null;
  focus?: Record<string, unknown> | null;
  caption?: string | null;
}

export interface ShotWriteResult {
  id: string;
  url: string;
  expiresAt: string;
  ttlSec: number;
  meta: ShotMeta;
}

const DEFAULT_TTL = 900;
const DEFAULT_MAX = 40;
const _moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolveShotDir(): string {
  return (
    process.env.S1914_SHOT_DIR?.trim() ||
    path.resolve(_moduleDir, "../data/shots")
  );
}

function ttlSecDefault(): number {
  const n = Number(process.env.S1914_SHOT_TTL_SEC);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TTL;
}

function maxShots(): number {
  const n = Number(process.env.S1914_SHOT_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX;
}

function publicBase(): string {
  return (
    process.env.S1914_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ||
    "http://127.0.0.1:8787"
  );
}

function ensureDir(): string {
  const dir = resolveShotDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function metaPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

function pngPath(dir: string, id: string): string {
  return path.join(dir, `${id}.png`);
}

function unlinkQuiet(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function gcShots(now = Date.now()): number {
  const dir = ensureDir();
  let removed = 0;
  const entries: { id: string; createdAt: number; expired: boolean }[] = [];

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const mp = metaPath(dir, id);
    try {
      const meta = JSON.parse(readFileSync(mp, "utf8")) as ShotMeta;
      const exp = Date.parse(meta.expiresAt);
      const created = Date.parse(meta.createdAt) || 0;
      const expired = !Number.isFinite(exp) || exp <= now;
      entries.push({ id, createdAt: created, expired });
      if (expired) {
        unlinkQuiet(pngPath(dir, id));
        unlinkQuiet(mp);
        removed++;
      }
    } catch {
      unlinkQuiet(mp);
      unlinkQuiet(pngPath(dir, id));
      removed++;
    }
  }

  const alive = entries
    .filter((e) => !e.expired)
    .sort((a, b) => a.createdAt - b.createdAt);
  const max = maxShots();
  while (alive.length > max) {
    const old = alive.shift();
    if (!old) break;
    unlinkQuiet(pngPath(dir, old.id));
    unlinkQuiet(metaPath(dir, old.id));
    removed++;
  }
  return removed;
}

export function writeShot(input: ShotWriteInput): ShotWriteResult {
  const dir = ensureDir();
  gcShots();
  const id = randomBytes(16).toString("hex");
  const ttlSec =
    input.ttlSec && input.ttlSec > 0 ? Math.floor(input.ttlSec) : ttlSecDefault();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const meta: ShotMeta = {
    id,
    expiresAt,
    ttlSec,
    gameId: input.gameId ?? null,
    focus: input.focus ?? null,
    caption: input.caption ?? null,
    bytes: input.png.length,
    createdAt,
  };
  writeFileSync(pngPath(dir, id), input.png);
  writeFileSync(metaPath(dir, id), JSON.stringify(meta, null, 2));
  return {
    id,
    url: `${publicBase()}/shots/${id}.png`,
    expiresAt,
    ttlSec,
    meta,
  };
}

export function readShotPng(
  id: string,
): { png: Buffer; meta: ShotMeta } | { error: "not_found" | "gone" } {
  if (!/^[a-f0-9]{32}$/i.test(id)) return { error: "not_found" };
  const dir = resolveShotDir();
  const mp = metaPath(dir, id);
  const pp = pngPath(dir, id);
  if (!existsSync(mp) || !existsSync(pp)) return { error: "not_found" };
  try {
    const meta = JSON.parse(readFileSync(mp, "utf8")) as ShotMeta;
    if (Date.parse(meta.expiresAt) <= Date.now()) {
      unlinkQuiet(pp);
      unlinkQuiet(mp);
      return { error: "gone" };
    }
    return { png: readFileSync(pp), meta };
  } catch {
    return { error: "not_found" };
  }
}

let gcTimer: ReturnType<typeof setInterval> | null = null;
export function startShotGc(intervalMs = 5 * 60_000): void {
  if (gcTimer) return;
  ensureDir();
  gcShots();
  gcTimer = setInterval(() => {
    try {
      gcShots();
    } catch {
      /* ignore */
    }
  }, intervalMs);
  if (typeof gcTimer === "object" && gcTimer && "unref" in gcTimer) {
    (gcTimer as NodeJS.Timeout).unref();
  }
}

export function shotStats(): { dir: string; count: number; bytes: number } {
  const dir = ensureDir();
  let count = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".png")) continue;
    count++;
    try {
      bytes += statSync(path.join(dir, name)).size;
    } catch {
      /* ignore */
    }
  }
  return { dir, count, bytes };
}
