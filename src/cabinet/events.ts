import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type CabinetEventKind =
  | "SPY_REPORT_RECEIVED"
  | "ARMY_SPOTTED"
  | "NAVAL_SIGHTED"
  | "AIR_SIGHTED"
  | "MARKET_PRICE_CHANGED"
  | "TRADE_EMBARGO_DETECTED"
  | "RESOURCE_SHORTAGE_FORECAST"
  | "WAR_DECLARED"
  | "DIPLOMACY_CHANGED"
  | "PROVINCE_CAPTURED"
  | "GENERAL_ORDER_CREATED"
  | "HERO_ASSIGNED"
  | "MOVE_VERIFIED"
  | "MOVE_FAILED"
  | "WAR_OPERATION"
  | "PLAYER_ORDER"
  | "MAP_DELTA"
  | "PLAYER_MANUAL_DELTA"
  | "SYSTEM";

export interface CabinetEvent {
  readonly id: string;
  readonly kind: CabinetEventKind;
  readonly t: string;
  readonly source?: string;
  readonly playerId?: number;
  readonly nation?: string;
  readonly location?: string;
  readonly confidence?: number;
  readonly payload?: Record<string, unknown>;
}

type Listener = (event: CabinetEvent) => void | Promise<void>;

function eventId(): string {
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** In-process event bus with optional jsonl persistence. */
export class CabinetEventBus {
  private readonly listeners = new Map<CabinetEventKind | "*", Set<Listener>>();
  private readonly recent: CabinetEvent[] = [];

  constructor(private readonly rootDir?: string) {}

  on(kind: CabinetEventKind | "*", listener: Listener): () => void {
    let set = this.listeners.get(kind);
    if (!set) {
      set = new Set();
      this.listeners.set(kind, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  async publish(
    kind: CabinetEventKind,
    partial: Omit<CabinetEvent, "id" | "kind" | "t"> & { t?: string } = {},
  ): Promise<CabinetEvent> {
    const event: CabinetEvent = {
      id: eventId(),
      kind,
      t: partial.t ?? new Date().toISOString(),
      source: partial.source,
      playerId: partial.playerId,
      nation: partial.nation,
      location: partial.location,
      confidence: partial.confidence,
      payload: partial.payload,
    };
    this.recent.push(event);
    while (this.recent.length > 200) this.recent.shift();
    if (this.rootDir) {
      try {
        await mkdir(this.rootDir, { recursive: true });
        await appendFile(
          path.join(this.rootDir, "events.jsonl"),
          `${JSON.stringify(event)}\n`,
          "utf8",
        );
      } catch {
        /* ignore persist errors */
      }
    }
    const targets = [
      ...(this.listeners.get(kind) ?? []),
      ...(this.listeners.get("*") ?? []),
    ];
    for (const fn of targets) {
      try {
        await fn(event);
      } catch (err) {
        console.warn(
          "[event-bus]",
          kind,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return event;
  }

  getRecent(limit = 40): CabinetEvent[] {
    return this.recent.slice(-limit);
  }

  async loadTail(limit = 50): Promise<CabinetEvent[]> {
    if (!this.rootDir) return this.getRecent(limit);
    try {
      const raw = await readFile(
        path.join(this.rootDir, "events.jsonl"),
        "utf8",
      );
      const rows = raw
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((l) => JSON.parse(l) as CabinetEvent);
      return rows;
    } catch {
      return this.getRecent(limit);
    }
  }
}

let singleton: CabinetEventBus | null = null;

export function getEventBus(rootDir?: string): CabinetEventBus {
  if (!singleton) singleton = new CabinetEventBus(rootDir);
  return singleton;
}

export async function trimEventLog(
  rootDir: string,
  keep = 400,
): Promise<void> {
  const file = path.join(rootDir, "events.jsonl");
  try {
    const raw = await readFile(file, "utf8");
    const rows = raw.split("\n").filter(Boolean);
    if (rows.length <= keep) return;
    await writeFile(file, `${rows.slice(-keep).join("\n")}\n`, "utf8");
  } catch {
    /* ok */
  }
}
