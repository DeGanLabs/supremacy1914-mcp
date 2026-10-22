import {
  mkdir,
  rename,
  readFile,
  writeFile,
  readdir,
  copyFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { PlayerGoal } from "./types.js";
import { CabinetMemory } from "./memory.js";

/** Files that live under games/{gameId}/ (match-scoped). */
const GAME_SCOPED_FILES = [
  "goals.json",
  "hypotheses.json",
  "plans.json",
  "hero-tasks.json",
  "facts.jsonl",
  "war-picture.json",
  "war-events.jsonl",
  "conversation.json",
  "field-delta.json",
  "plan-reconcile.json",
  "groups.json",
  "generals.json",
  "intel.json",
  "commands.json",
  "finance-picture.json",
  "finance-events.jsonl",
  "war-demand.json",
] as const;

/** Stay at CABINET_DATA_DIR root (shared across matches). */
export const BASE_SCOPED = [
  "bridge.token",
  "session.json",
  "telegram-topics.json",
] as const;

export interface SessionState {
  readonly activeGameId: number | null;
  readonly playerId: number | null;
  readonly nation: string | null;
  readonly dataDir: string;
  readonly switchedAt: string | null;
  readonly previousGameId: number | null;
}

export interface GameHelloMeta {
  readonly gameId: number;
  readonly playerId: number;
  readonly nation?: string | null;
}

function gameDir(baseDir: string, gameId: number): string {
  return path.join(baseDir, "games", String(gameId));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(src: string, dest: string): Promise<void> {
  if (!(await pathExists(src))) return;
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

/**
 * Owns match-scoped memory roots. Bridge hello switches gameId → archive + clean goals.
 */
export class GameSession {
  private state: SessionState;
  readonly memory: CabinetMemory;

  constructor(private readonly baseDir: string) {
    this.state = {
      activeGameId: null,
      playerId: null,
      nation: null,
      dataDir: baseDir,
      switchedAt: null,
      previousGameId: null,
    };
    this.memory = new CabinetMemory(baseDir);
  }

  get baseDataDir(): string {
    return this.baseDir;
  }

  /** Active match directory (or base until first hello). */
  get dataDir(): string {
    return this.state.dataDir;
  }

  get snapshot(): SessionState {
    return { ...this.state };
  }

  async init(): Promise<SessionState> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(path.join(this.baseDir, "games"), { recursive: true });
    await mkdir(path.join(this.baseDir, "archive"), { recursive: true });

    const saved = await this.loadSessionFile();
    if (saved?.activeGameId != null) {
      const dir = gameDir(this.baseDir, saved.activeGameId);
      await mkdir(dir, { recursive: true });
      await mkdir(path.join(dir, "seats"), { recursive: true });
      this.memory.rebind(dir);
      this.state = {
        activeGameId: saved.activeGameId,
        playerId: saved.playerId,
        nation: saved.nation,
        dataDir: dir,
        switchedAt: saved.switchedAt,
        previousGameId: saved.previousGameId ?? null,
      };
      await this.memory.init();
    } else {
      // Legacy flat layout — migrate into games/ on first hello.
      await this.memory.init();
    }
    return this.snapshot;
  }

  /**
   * Call on every bridge hello. Returns whether the active match changed.
   */
  async onBridgeHello(meta: GameHelloMeta): Promise<{
    switched: boolean;
    session: SessionState;
    message: string | null;
  }> {
    const prevId = this.state.activeGameId;
    if (prevId === meta.gameId) {
      this.state = {
        ...this.state,
        playerId: meta.playerId,
        nation: meta.nation ?? this.state.nation,
      };
      await this.saveSessionFile();
      // Drop goals that cite theaters absent from the live picture.
      await this.scrubStaleGoals();
      return { switched: false, session: this.snapshot, message: null };
    }

    // Archive previous match folder (or legacy flat files).
    if (prevId != null) {
      await this.archiveGameDir(prevId);
    } else {
      await this.migrateLegacyIntoArchive(meta.gameId);
    }

    const dir = gameDir(this.baseDir, meta.gameId);
    await mkdir(dir, { recursive: true });
    await mkdir(path.join(dir, "seats"), { recursive: true });
    this.memory.rebind(dir);
    await this.memory.init();
    // Fresh match — empty goals (do not carry Africa into Lithuania).
    await this.memory.replaceGoals([]);
    await this.memory.saveConversationState({
      seatIds: [],
      activeAdvisor: null,
      transcript: [],
      updatedAt: new Date().toISOString(),
    });

    this.state = {
      activeGameId: meta.gameId,
      playerId: meta.playerId,
      nation: meta.nation ?? null,
      dataDir: dir,
      switchedAt: new Date().toISOString(),
      previousGameId: prevId,
    };
    await this.saveSessionFile();

    const msg = `🆕 New match \`${meta.gameId}\`${
      meta.nation ? ` · ${meta.nation}` : ""
    } — memory reset (old goals archived).`;
    console.log(
      `[session] switched ${prevId ?? "none"} → ${meta.gameId} dir=${dir}`,
    );
    return { switched: true, session: this.snapshot, message: msg };
  }

  /** SESSION line for minister / chief prompts. */
  sessionPromptBlock(): string {
    const s = this.state;
    if (s.activeGameId == null) {
      return "SESSION: no game bound yet — wait for bridge hello.";
    }
    return `SESSION gameId=${s.activeGameId} playerId=${s.playerId ?? "?"} nation=${s.nation ?? "?"} — cite only the live war picture for THIS match. Do not invent theaters; do not mention theaters that are absent from tools.`;
  }

  /**
   * Remove goals whose theater keywords are not present in the current war picture.
   */
  async scrubStaleGoals(): Promise<number> {
    const goals = await this.memory.getGoals();
    if (!goals.length) return 0;
    const pic = await this.memory.loadWarPicture<{
      gameId?: number;
      myNation?: string;
      atWar?: Array<{ nation?: string; name?: string }>;
      fronts?: Array<{ name?: string }>;
      zones?: Array<{ nation?: string }>;
      picture?: {
        diplo?: { atWar?: Array<{ nation?: string }> };
        myNation?: string;
      };
    }>();
    if (!pic) return 0;
    const kept = filterGoalsForPicture(goals, pic);
    if (kept.length === goals.length) return 0;
    await this.memory.replaceGoals(kept);
    const dropped = goals.length - kept.length;
    console.log(`[session] scrubbed ${dropped} stale goal(s)`);
    return dropped;
  }

  private async archiveGameDir(gameId: number): Promise<void> {
    const src = gameDir(this.baseDir, gameId);
    if (!(await pathExists(src))) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(this.baseDir, "archive", `${gameId}-${stamp}`);
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(src, dest);
  }

  /** Move flat legacy files aside before binding a new game folder. */
  private async migrateLegacyIntoArchive(newGameId: number): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(
      this.baseDir,
      "archive",
      `legacy-before-${newGameId}-${stamp}`,
    );
    let any = false;
    for (const name of GAME_SCOPED_FILES) {
      const src = path.join(this.baseDir, name);
      if (await pathExists(src)) {
        if (!any) {
          await mkdir(dest, { recursive: true });
          any = true;
        }
        await rename(src, path.join(dest, name));
      }
    }
    const seatsSrc = path.join(this.baseDir, "seats");
    if (await pathExists(seatsSrc)) {
      if (!any) {
        await mkdir(dest, { recursive: true });
        any = true;
      }
      await rename(seatsSrc, path.join(dest, "seats"));
    }
    if (any) {
      console.log(`[session] archived legacy flat files → ${dest}`);
    }
  }

  private async loadSessionFile(): Promise<{
    activeGameId: number | null;
    playerId: number | null;
    nation: string | null;
    switchedAt: string | null;
    previousGameId?: number | null;
  } | null> {
    try {
      const raw = await readFile(
        path.join(this.baseDir, "session.json"),
        "utf8",
      );
      return JSON.parse(raw) as {
        activeGameId: number | null;
        playerId: number | null;
        nation: string | null;
        switchedAt: string | null;
        previousGameId?: number | null;
      };
    } catch {
      return null;
    }
  }

  private async saveSessionFile(): Promise<void> {
    await writeFile(
      path.join(this.baseDir, "session.json"),
      JSON.stringify(
        {
          activeGameId: this.state.activeGameId,
          playerId: this.state.playerId,
          nation: this.state.nation,
          switchedAt: this.state.switchedAt,
          previousGameId: this.state.previousGameId,
          dataDir: this.state.dataDir,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}

const THEATER_HINTS = [
  "morocco",
  "maroco",
  "libya",
  "béchar",
  "bechar",
  "africa",
  "afrika",
  "khofra",
  "sidi barrani",
  "central usa",
  "alaska",
  "yakut",
  "whitehorse",
  "tunisia",
];

/** Keep goals that are generic or mention theater present in the live picture. */
export function filterGoalsForPicture(
  goals: readonly PlayerGoal[],
  pic: {
    myNation?: string;
    atWar?: Array<{ nation?: string; name?: string }>;
    fronts?: Array<{ name?: string }>;
    zones?: Array<{ nation?: string }>;
    picture?: {
      myNation?: string;
      diplo?: { atWar?: Array<{ nation?: string }> };
    };
  },
): PlayerGoal[] {
  const names = new Set<string>();
  const add = (s?: string) => {
    if (s?.trim()) names.add(s.toLowerCase());
  };
  add(pic.myNation);
  add(pic.picture?.myNation);
  for (const w of pic.atWar ?? []) {
    add(w.nation);
    add(w.name);
  }
  for (const w of pic.picture?.diplo?.atWar ?? []) add(w.nation);
  for (const f of pic.fronts ?? []) add(f.name);
  for (const z of pic.zones ?? []) add(z.nation);
  const nameBlob = [...names].join(" ");

  return goals.filter((g) => {
    const blob = `${g.key} ${g.value}`.toLowerCase();
    const hints = THEATER_HINTS.filter((h) => blob.includes(h));
    if (!hints.length) return true; // generic goal
    // Keep if any hint appears as a live nation/front token or substring of known names
    return hints.some(
      (h) =>
        nameBlob.includes(h) ||
        [...names].some((n) => n.includes(h) || h.includes(n.split(/\s+/)[0]!)),
    );
  });
}

/** One-line summary for MCP /status. */
export async function listArchivedGames(baseDir: string): Promise<string[]> {
  try {
    const dir = path.join(baseDir, "archive");
    const entries = await readdir(dir);
    return entries.slice(-20);
  } catch {
    return [];
  }
}

export async function ensureGameScaffold(
  baseDir: string,
  gameId: number,
): Promise<string> {
  const dir = gameDir(baseDir, gameId);
  await mkdir(path.join(dir, "seats"), { recursive: true });
  return dir;
}

/** Copy bridge.token stays at base — helper for tests. */
export async function mirrorTokenToGame(
  baseDir: string,
  gameId: number,
): Promise<void> {
  await copyIfExists(
    path.join(baseDir, "bridge.token"),
    path.join(gameDir(baseDir, gameId), "bridge.token"),
  );
}
