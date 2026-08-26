import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { FinancePicture, WarDemand } from "./types.js";
import { formatFinanceBrief } from "./format.js";

const MAX_EVENTS = 400;

export class FinanceMemory {
  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await this.ensureJson("finance-picture.json", null);
    await this.ensureJson("war-demand.json", []);
    await this.ensureFile("finance-events.jsonl", "");
  }

  async saveFinancePicture(picture: FinancePicture): Promise<void> {
    await this.writeJson("finance-picture.json", picture);
  }

  async loadFinancePicture(): Promise<FinancePicture | null> {
    try {
      const v = await this.readJson<FinancePicture | null>("finance-picture.json");
      return v;
    } catch {
      return null;
    }
  }

  async loadFinanceBrief(): Promise<string> {
    const pic = await this.loadFinancePicture();
    if (!pic) return "(no finance picture yet — bridge + finance watch)";
    return formatFinanceBrief(pic);
  }

  async saveWarDemand(demands: WarDemand[]): Promise<void> {
    await this.writeJson("war-demand.json", demands);
  }

  async loadWarDemand(): Promise<WarDemand[]> {
    try {
      return (await this.readJson<WarDemand[]>("war-demand.json")) ?? [];
    } catch {
      return [];
    }
  }

  async appendEvent(line: string, provinceName?: string): Promise<void> {
    const file = path.join(this.rootDir, "finance-events.jsonl");
    const row = {
      t: new Date().toISOString(),
      line: provinceName ? `${provinceName}: ${line}` : line,
    };
    await appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
    const raw = await readFile(file, "utf8");
    const rows = raw.split("\n").filter(Boolean);
    if (rows.length > MAX_EVENTS) {
      await writeFile(file, `${rows.slice(-Math.floor(MAX_EVENTS / 2)).join("\n")}\n`, "utf8");
    }
  }

  async loadRecentEvents(limit = 50): Promise<{ t: string; line: string }[]> {
    try {
      const raw = await readFile(path.join(this.rootDir, "finance-events.jsonl"), "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((l) => JSON.parse(l) as { t: string; line: string });
    } catch {
      return [];
    }
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
    return JSON.parse(await readFile(path.join(this.rootDir, name), "utf8")) as T;
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    await writeFile(
      path.join(this.rootDir, name),
      JSON.stringify(value, null, 2),
      "utf8",
    );
  }
}
