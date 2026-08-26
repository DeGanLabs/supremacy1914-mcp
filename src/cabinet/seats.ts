import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SEAT_SCOPES } from "./cost-caps.js";
import type { SeatDefinition } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SEATS: SeatDefinition[] = [
  {
    id: "foreign",
    name: "Foreign Affairs",
    role: "Diplomacy and messaging",
    mentionAliases: ["@Foreign", "@Diplo", "@Diplomacy"],
    dataScopes: DEFAULT_SEAT_SCOPES.foreign,
    systemPromptPath: "foreign.md",
  },
  {
    id: "war",
    name: "War Minister",
    role: "Offense and concentration",
    mentionAliases: ["@War"],
    dataScopes: DEFAULT_SEAT_SCOPES.war,
    systemPromptPath: "war.md",
  },
  {
    id: "defense",
    name: "Defense Minister",
    role: "Hold lines and garrisons",
    mentionAliases: ["@Defense", "@Defence"],
    dataScopes: DEFAULT_SEAT_SCOPES.defense,
    systemPromptPath: "defense.md",
  },
  {
    id: "finance",
    name: "Finance & Infrastructure",
    role: "Economy and builds",
    mentionAliases: ["@Finance", "@Eco"],
    dataScopes: DEFAULT_SEAT_SCOPES.finance,
    systemPromptPath: "finance.md",
  },
  {
    id: "intel",
    name: "Intelligence Ops",
    role: "Verify and recon",
    mentionAliases: ["@Intel", "@Intelligence"],
    dataScopes: DEFAULT_SEAT_SCOPES.intel,
    systemPromptPath: "intel.md",
  },
];

export class SeatRegistry {
  private seats: SeatDefinition[];

  constructor(initial: SeatDefinition[] = DEFAULT_SEATS) {
    this.seats = [...initial];
  }

  list(): SeatDefinition[] {
    return [...this.seats];
  }

  get(id: string): SeatDefinition | undefined {
    return this.seats.find((s) => s.id === id);
  }

  resolveMentions(text: string): { all: boolean; cabinetOnly: boolean; seats: SeatDefinition[] } {
    const lower = text.toLowerCase();
    if (/(^|\s)@all\b/.test(lower)) {
      return { all: true, cabinetOnly: false, seats: this.list() };
    }
    if (/(^|\s)@cabinet\b/.test(lower)) {
      return { all: false, cabinetOnly: true, seats: [] };
    }
    const hit: SeatDefinition[] = [];
    for (const seat of this.seats) {
      for (const alias of seat.mentionAliases) {
        if (lower.includes(alias.toLowerCase())) {
          hit.push(seat);
          break;
        }
      }
    }
    return { all: false, cabinetOnly: false, seats: hit };
  }

  add(seat: SeatDefinition): void {
    if (this.get(seat.id)) throw new Error(`seat exists: ${seat.id}`);
    this.seats.push(seat);
  }

  remove(id: string): void {
    this.seats = this.seats.filter((s) => s.id !== id);
  }

  async loadPrompt(seat: SeatDefinition): Promise<string> {
    const voice = await readFile(path.join(HERE, "prompts", "voice.md"), "utf8");
    const body = await readFile(
      path.join(HERE, "prompts", seat.systemPromptPath),
      "utf8",
    );
    let doctrine = "";
    if (seat.id === "war") {
      try {
        const full = await readFile(
          path.join(HERE, "prompts", "doctrine", "naval-coastal.md"),
          "utf8",
        );
        doctrine = `\n\n---\n\n${full.trim()}`;
      } catch {
        doctrine = "";
      }
    } else if (seat.id === "defense" || seat.id === "intel") {
      doctrine = `\n\n---\n\nNaval/coastal handoff: bombard-first on coastal stacks; never invent damage numbers; NEED_SPY / @Intel before committing battleships into unknown waters; embarked transports = priority kills; keep main ground hammer together.`;
    }
    return `${voice.trim()}\n\n---\n\n${body.trim()}${doctrine}\n\nAllowed tools: ${seat.dataScopes.join(", ")}`;
  }

  async loadChiefPrompt(): Promise<string> {
    const voice = await readFile(path.join(HERE, "prompts", "voice.md"), "utf8");
    const chief = await readFile(path.join(HERE, "prompts", "chief.md"), "utf8");
    return `${voice.trim()}\n\n---\n\n${chief.trim()}`;
  }
}
