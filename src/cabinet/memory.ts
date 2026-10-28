import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type {
  CabinetPlan,
  Hypothesis,
  PlayerGoal,
} from "../cabinet/types.js";
import { COST_CAPS } from "./cost-caps.js";
import type { CabinetLanguage } from "./language.js";

const MAX_FACTS = 200;
const MAX_HYPOTHESES = 50;
const MAX_SEAT_LINES = 40;

export interface ConversationTranscriptEntry {
  t: string;
  role: "user" | "seat" | "system";
  seatId?: string;
  text: string;
}

export interface LastDiploDraft {
  text: string;
  targetNation?: string;
  targetPlayerId?: number;
  language?: string;
  seatId?: string;
  savedAt: string;
}

export interface RecentAction {
  t: string;
  kind: string;
  detail: string;
}

export interface ConversationState {
  seatIds: string[];
  activeAdvisor?: string | null;
  lastPlanId?: string;
  autoPilot?: boolean;
  humanMode?: string;
  /** Default advisor speech language. */
  cabinetLanguage?: CabinetLanguage;
  /** Last Foreign draft ready to send. */
  lastDraft?: LastDiploDraft | null;
  /** Recent executed / sent actions for advisor awareness. */
  recentActions?: RecentAction[];
  transcript?: ConversationTranscriptEntry[];
  updatedAt: string;
}

export class CabinetMemory {
  constructor(private rootDir: string) {}

  /** Active match-scoped directory. */
  getRootDir(): string {
    return this.rootDir;
  }

  /** Point memory at games/{gameId} after a match switch. */
  rebind(rootDir: string): void {
    this.rootDir = rootDir;
  }

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(path.join(this.rootDir, "seats"), { recursive: true });
    await this.ensureJson("goals.json", []);
    await this.ensureJson("hypotheses.json", []);
    await this.ensureJson("plans.json", []);
    await this.ensureJson("hero-tasks.json", []);
    await this.ensureFile("facts.jsonl", "");
  }

  async getGoals(): Promise<PlayerGoal[]> {
    return this.readJson<PlayerGoal[]>("goals.json");
  }

  async setGoal(key: string, value: string): Promise<PlayerGoal> {
    const goals = await this.getGoals();
    const next: PlayerGoal = { key, value, setAt: new Date().toISOString() };
    const filtered = goals.filter((g) => g.key !== key);
    filtered.push(next);
    await this.writeJson("goals.json", filtered);
    return next;
  }

  async getHypotheses(): Promise<Hypothesis[]> {
    return this.readJson<Hypothesis[]>("hypotheses.json");
  }

  async addHypothesis(h: Hypothesis): Promise<void> {
    const list = await this.getHypotheses();
    list.push(h);
    while (list.length > MAX_HYPOTHESES) list.shift();
    await this.writeJson("hypotheses.json", list);
  }

  async getPlans(): Promise<CabinetPlan[]> {
    return this.readJson<CabinetPlan[]>("plans.json");
  }

  async savePlan(plan: CabinetPlan): Promise<void> {
    const plans = await this.getPlans();
    const idx = plans.findIndex((p) => p.id === plan.id);
    if (idx >= 0) plans[idx] = plan;
    else plans.push(plan);
    await this.writeJson("plans.json", plans);
  }

  async getPlan(id: string): Promise<CabinetPlan | null> {
    const plans = await this.getPlans();
    return plans.find((p) => p.id === id) ?? null;
  }

  async appendFact(line: string): Promise<void> {
    const file = path.join(this.rootDir, "facts.jsonl");
    await appendFile(file, `${JSON.stringify({ t: new Date().toISOString(), line })}\n`, "utf8");
    const raw = await readFile(file, "utf8");
    const rows = raw.split("\n").filter(Boolean);
    if (rows.length > MAX_FACTS) {
      const kept = rows.slice(-Math.floor(MAX_FACTS / 2));
      await writeFile(file, `${kept.join("\n")}\n`, "utf8");
    }
  }

  async appendSeatNote(seatId: string, note: string): Promise<void> {
    const file = path.join(this.rootDir, "seats", `${seatId}.json`);
    let lines: string[] = [];
    try {
      lines = JSON.parse(await readFile(file, "utf8")) as string[];
    } catch {
      lines = [];
    }
    lines.push(`${new Date().toISOString()} ${note}`);
    while (lines.length > MAX_SEAT_LINES) lines.shift();
    await writeFile(file, JSON.stringify(lines, null, 2), "utf8");
  }

  async loadSeatNotes(seatId: string, limit = 8): Promise<string[]> {
    const file = path.join(this.rootDir, "seats", `${seatId}.json`);
    try {
      const lines = JSON.parse(await readFile(file, "utf8")) as string[];
      return lines.slice(-limit);
    } catch {
      return [];
    }
  }

  async saveHeroTasks(tasks: unknown): Promise<void> {
    await this.writeJson("hero-tasks.json", tasks);
  }

  async loadHeroTasks<T = unknown>(): Promise<T | null> {
    try {
      return await this.readJson<T>("hero-tasks.json");
    } catch {
      return null;
    }
  }

  async goalsBlock(): Promise<string> {
    const goals = await this.getGoals();
    if (!goals.length) return "(no standing goals)";
    return goals.map((g) => `- ${g.key}: ${g.value}`).join("\n");
  }

  async saveWarPicture(snapshot: unknown): Promise<void> {
    await this.writeJson("war-picture.json", snapshot);
  }

  async loadWarPicture<T = unknown>(): Promise<T | null> {
    try {
      return await this.readJson<T>("war-picture.json");
    } catch {
      return null;
    }
  }

  async appendWarEvent(event: unknown): Promise<void> {
    const file = path.join(this.rootDir, "war-events.jsonl");
    await appendFile(
      file,
      `${JSON.stringify({ t: new Date().toISOString(), event })}\n`,
      "utf8",
    );
    const raw = await readFile(file, "utf8");
    const rows = raw.split("\n").filter(Boolean);
    if (rows.length > 300) {
      const kept = rows.slice(-150);
      await writeFile(file, `${kept.join("\n")}\n`, "utf8");
    }
  }

  async saveConversationState(state: ConversationState): Promise<void> {
    await this.writeJson("conversation.json", state);
  }

  async loadConversationState(): Promise<ConversationState | null> {
    try {
      return await this.readJson<ConversationState>("conversation.json");
    } catch {
      return null;
    }
  }

  private emptyConversation(): ConversationState {
    return {
      seatIds: [],
      updatedAt: new Date().toISOString(),
    };
  }

  async setActiveAdvisor(seatId: string | null): Promise<void> {
    const prev = (await this.loadConversationState()) ?? this.emptyConversation();
    await this.saveConversationState({
      ...prev,
      seatIds: seatId ? [seatId] : prev.seatIds,
      activeAdvisor: seatId,
      updatedAt: new Date().toISOString(),
    });
  }

  async setAutoPilot(on: boolean): Promise<void> {
    const prev = (await this.loadConversationState()) ?? this.emptyConversation();
    await this.saveConversationState({
      ...prev,
      autoPilot: on,
      humanMode: on ? "AUTO" : "CONFIRM",
      updatedAt: new Date().toISOString(),
    });
  }

  async setHumanMode(
    mode: "AUTO" | "SUGGEST" | "CONFIRM" | "PAUSE" | "ABORT",
  ): Promise<void> {
    const prev = (await this.loadConversationState()) ?? this.emptyConversation();
    await this.saveConversationState({
      ...prev,
      humanMode: mode,
      autoPilot: mode === "AUTO",
      updatedAt: new Date().toISOString(),
    });
  }

  async setCabinetLanguage(lang: CabinetLanguage): Promise<void> {
    const prev = (await this.loadConversationState()) ?? this.emptyConversation();
    await this.saveConversationState({
      ...prev,
      cabinetLanguage: lang,
      updatedAt: new Date().toISOString(),
    });
  }

  async setLastDraft(draft: LastDiploDraft | null): Promise<void> {
    const prev = (await this.loadConversationState()) ?? this.emptyConversation();
    await this.saveConversationState({
      ...prev,
      lastDraft: draft,
      updatedAt: new Date().toISOString(),
    });
  }

  async appendRecentAction(kind: string, detail: string): Promise<void> {
    const prev = (await this.loadConversationState()) ?? this.emptyConversation();
    const recentActions = [...(prev.recentActions ?? [])];
    recentActions.push({
      t: new Date().toISOString(),
      kind,
      detail: detail.trim().slice(0, 240),
    });
    while (recentActions.length > 16) recentActions.shift();
    await this.saveConversationState({
      ...prev,
      recentActions,
      updatedAt: new Date().toISOString(),
    });
  }

  async loadRecentActionsBrief(): Promise<string> {
    const state = await this.loadConversationState();
    const rows = state?.recentActions ?? [];
    if (!rows.length) return "";
    return rows
      .slice(-10)
      .map((r) => `- [${r.kind}] ${r.detail}`)
      .join("\n");
  }

  async replaceGoals(goals: PlayerGoal[]): Promise<void> {
    await this.writeJson("goals.json", goals);
  }

  async appendTranscript(entry: {
    role: "user" | "seat" | "system";
    seatId?: string;
    text: string;
  }): Promise<void> {
    const prev = (await this.loadConversationState()) ?? this.emptyConversation();
    const transcript = [...(prev.transcript ?? [])];
    const maxChars = COST_CAPS.maxTranscriptChars ?? 1200;
    const text = entry.text.trim().slice(0, maxChars);
    if (!text) return;
    transcript.push({
      t: new Date().toISOString(),
      role: entry.role,
      seatId: entry.seatId,
      text,
    });
    const maxLines = COST_CAPS.maxChatTranscript ?? 24;
    while (transcript.length > maxLines) transcript.shift();
    await this.saveConversationState({
      ...prev,
      transcript,
      updatedAt: new Date().toISOString(),
    });
  }

  async loadTranscriptBlock(): Promise<string> {
    const state = await this.loadConversationState();
    const rows = state?.transcript ?? [];
    if (!rows.length) return "";
    return rows
      .map((r) => {
        const who =
          r.role === "user"
            ? "President"
            : r.role === "seat"
              ? `@${r.seatId ?? "seat"}`
              : "System";
        return `${who}: ${r.text}`;
      })
      .join("\n");
  }

  async loadWarBrief(): Promise<string> {
    const snap = await this.loadWarPicture<{
      takenAt?: string;
      myNation?: string;
      atWar?: { nation?: string; name?: string; id?: number }[];
      zones?: { level: string; nation: string; note: string; provinces?: string[] }[];
      triggers?: { line: string }[];
      sensorDegraded?: boolean;
    }>();
    if (!snap) return "(no war watch snapshot yet — bridge + get_war_picture)";
    const wars = (snap.atWar || [])
      .map((w) => w.nation || w.name || w.id)
      .join(", ");
    const high = (snap.zones || [])
      .filter((z) => z.level === "high")
      .slice(0, 5)
      .map(
        (z) =>
          `HIGH ${z.nation}: ${(z.provinces || []).slice(0, 3).join("/")} — ${z.note}`,
      );
    const med = (snap.zones || [])
      .filter((z) => z.level === "medium")
      .slice(0, 3)
      .map((z) => `MED ${z.nation}: ${z.note}`);
    const trig = (snap.triggers || []).slice(0, 5).map((t) => t.line);
    return [
      `Last watch: ${snap.takenAt ?? "?"} nation=${snap.myNation ?? "?"}`,
      snap.sensorDegraded ? "SENSOR_DEGRADED" : null,
      `Wars: ${wars || "none"}`,
      ...high,
      ...med,
      ...(trig.length ? ["Triggers:", ...trig.map((t) => `  ${t}`)] : []),
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Latest manual field-change brief from war-watch map diff. */
  async saveFieldDelta(report: {
    readonly takenAt: string;
    readonly brief: string;
    readonly manualCount: number;
    readonly highSignalLines?: readonly string[];
  }): Promise<void> {
    await this.writeJson("field-delta.json", {
      takenAt: report.takenAt,
      brief: report.brief,
      manualCount: report.manualCount,
      highSignalLines: report.highSignalLines ?? [],
      updatedAt: new Date().toISOString(),
    });
  }

  async saveReconcileBrief(brief: string): Promise<void> {
    await this.writeJson("plan-reconcile.json", {
      brief,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Inject into minister context: player UI moves + stale plans. */
  async loadFieldAwarenessBrief(): Promise<string> {
    const parts: string[] = [];
    try {
      const delta = await this.readJson<{
        takenAt?: string;
        brief?: string;
        updatedAt?: string;
      }>("field-delta.json");
      const age = Date.parse(delta.updatedAt || delta.takenAt || "");
      if (
        delta.brief &&
        Number.isFinite(age) &&
        Date.now() - age < 30 * 60_000
      ) {
        parts.push(delta.brief);
      }
    } catch {
      /* none */
    }
    try {
      const rec = await this.readJson<{
        brief?: string;
        updatedAt?: string;
      }>("plan-reconcile.json");
      const age = Date.parse(rec.updatedAt || "");
      if (
        rec.brief &&
        Number.isFinite(age) &&
        Date.now() - age < 30 * 60_000
      ) {
        parts.push(rec.brief);
      }
    } catch {
      /* none */
    }
    return parts.filter(Boolean).join("\n\n");
  }

  private async ensureJson(name: string, value: unknown): Promise<void> {
    const file = path.join(this.rootDir, name);
    try {
      await readFile(file, "utf8");
    } catch {
      await writeFile(file, JSON.stringify(value, null, 2), "utf8");
    }
  }

  private async ensureFile(name: string, value: string): Promise<void> {
    const file = path.join(this.rootDir, name);
    try {
      await readFile(file, "utf8");
    } catch {
      await writeFile(file, value, "utf8");
    }
  }

  private async readJson<T>(name: string): Promise<T> {
    const file = path.join(this.rootDir, name);
    return JSON.parse(await readFile(file, "utf8")) as T;
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const file = path.join(this.rootDir, name);
    await writeFile(file, JSON.stringify(value, null, 2), "utf8");
  }
}
