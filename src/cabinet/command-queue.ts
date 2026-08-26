import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserBridgeServer } from "../sensor/bridge-client.js";
import { getEventBus } from "./events.js";

export type CommandStatus =
  | "queued"
  | "waiting"
  | "executing"
  | "verified"
  | "failed"
  | "cancelled"
  | "expired";

export type CommandAction =
  | "moveArmy"
  | "attackArmy"
  | "delayArmy"
  | "constructBuilding"
  | "hold"
  | "recon";

export interface CommandConditions {
  enemy_strength_max?: number;
  friendly_strength_min?: number;
  artillery_ready?: boolean;
  air_cover?: boolean;
}

export interface QueuedCommand {
  command_id: string;
  priority: number;
  created_at: string;
  not_before?: string;
  expires_at?: string;
  commander?: string;
  group?: string;
  army?: number;
  action: CommandAction;
  target?: Record<string, unknown>;
  conditions?: CommandConditions;
  on_fail?: "hold" | "request_replan" | "abort";
  risk: "low" | "medium" | "high";
  status: CommandStatus;
  attempt: number;
  expected_state?: Record<string, unknown>;
  observed_state?: Record<string, unknown>;
  verification?: "pending" | "verified" | "failed";
  detail?: string;
}

function cmdId(): string {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export class CommandQueue {
  private commands: QueuedCommand[] = [];
  private paused = false;
  private emergencyStop = false;

  constructor(private readonly rootDir: string) {}

  async load(): Promise<void> {
    try {
      await mkdir(this.rootDir, { recursive: true });
      const raw = await readFile(
        path.join(this.rootDir, "commands.json"),
        "utf8",
      );
      this.commands = JSON.parse(raw) as QueuedCommand[];
    } catch {
      this.commands = [];
    }
  }

  async save(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(
      path.join(this.rootDir, "commands.json"),
      JSON.stringify(this.commands, null, 2),
      "utf8",
    );
  }

  setPaused(on: boolean): void {
    this.paused = on;
  }

  isPaused(): boolean {
    return this.paused || this.emergencyStop;
  }

  setEmergencyStop(on: boolean): void {
    this.emergencyStop = on;
    if (on) {
      for (const c of this.commands) {
        if (
          c.status === "queued" ||
          c.status === "waiting" ||
          c.status === "executing"
        ) {
          c.status = "cancelled";
          c.detail = "emergency stop";
        }
      }
    }
  }

  isEmergencyStopped(): boolean {
    return this.emergencyStop;
  }

  list(limit = 40): QueuedCommand[] {
    return this.commands.slice(-limit);
  }

  async enqueue(
    input: Omit<
      QueuedCommand,
      "command_id" | "created_at" | "status" | "attempt" | "verification"
    > & { command_id?: string },
  ): Promise<QueuedCommand> {
    const existing = input.command_id
      ? this.commands.find((c) => c.command_id === input.command_id)
      : undefined;
    if (existing?.verification === "verified") {
      return existing;
    }
    const cmd: QueuedCommand = {
      ...input,
      command_id: input.command_id ?? cmdId(),
      created_at: new Date().toISOString(),
      status: input.not_before ? "waiting" : "queued",
      attempt: existing ? existing.attempt + 1 : 0,
      verification: "pending",
      risk: input.risk ?? "medium",
      priority: input.priority ?? 50,
      action: input.action,
    };
    if (existing) {
      const idx = this.commands.findIndex(
        (c) => c.command_id === existing.command_id,
      );
      this.commands[idx] = cmd;
    } else {
      this.commands.push(cmd);
    }
    while (this.commands.length > 300) this.commands.shift();
    await this.save();
    await getEventBus(this.rootDir).publish("GENERAL_ORDER_CREATED", {
      source: "command-queue",
      payload: {
        command_id: cmd.command_id,
        action: cmd.action,
        army: cmd.army,
        group: cmd.group,
      },
    });
    return cmd;
  }

  /** Persist an already-executed command (Approve/Auto) without re-running. */
  async logVerified(
    input: Omit<
      QueuedCommand,
      "command_id" | "created_at" | "status" | "attempt" | "verification"
    > & { detail?: string; observed_state?: Record<string, unknown> },
  ): Promise<QueuedCommand> {
    const cmd: QueuedCommand = {
      ...input,
      command_id: cmdId(),
      created_at: new Date().toISOString(),
      status: "verified",
      attempt: 1,
      verification: "verified",
      risk: input.risk ?? "medium",
      priority: input.priority ?? 50,
      action: input.action,
      detail: input.detail ?? "ok",
      observed_state: input.observed_state,
    };
    this.commands.push(cmd);
    while (this.commands.length > 300) this.commands.shift();
    await this.save();
    await getEventBus(this.rootDir).publish("MOVE_VERIFIED", {
      source: "command-queue",
      payload: { command_id: cmd.command_id, army: cmd.army },
    });
    return cmd;
  }

  /** Pop next runnable command (respects pause / not_before / priority). */
  peekReady(now = new Date()): QueuedCommand | null {
    if (this.isPaused()) return null;
    const iso = now.toISOString();
    const ready = this.commands
      .filter((c) => {
        if (c.status === "verified" || c.status === "cancelled") return false;
        if (c.status === "failed" && c.attempt >= 3) return false;
        if (c.expires_at && c.expires_at < iso) {
          c.status = "expired";
          return false;
        }
        if (c.not_before && c.not_before > iso) {
          c.status = "waiting";
          return false;
        }
        return (
          c.status === "queued" ||
          c.status === "waiting" ||
          (c.status === "failed" && c.attempt < 3)
        );
      })
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
    return ready[0] ?? null;
  }

  async mark(
    commandId: string,
    patch: Partial<QueuedCommand>,
  ): Promise<QueuedCommand | null> {
    const idx = this.commands.findIndex((c) => c.command_id === commandId);
    if (idx < 0) return null;
    const next = { ...this.commands[idx]!, ...patch };
    this.commands[idx] = next;
    await this.save();
    return next;
  }

  /**
   * Execute one ready moveArmy/attack/delay/construct via bridge.
   * Conditions that cannot be evaluated are treated as pass (optimistic).
   */
  async executeNext(
    bridge: BrowserBridgeServer,
  ): Promise<QueuedCommand | null> {
    const cmd = this.peekReady();
    if (!cmd) return null;
    if (!bridge.isHealthy()) return null;

    await this.mark(cmd.command_id, {
      status: "executing",
      attempt: cmd.attempt + 1,
    });

    try {
      let result: unknown;
      const target = cmd.target ?? {};
      if (cmd.action === "moveArmy" && cmd.army != null) {
        result = await bridge.call("moveArmy", {
          armyId: cmd.army,
          x: target.x,
          y: target.y,
          append: !!target.append,
        });
      } else if (cmd.action === "attackArmy" && cmd.army != null) {
        result = await bridge.call("attackArmy", {
          armyId: cmd.army,
          targetArmyId: target.targetArmyId,
        });
      } else if (cmd.action === "delayArmy" && cmd.army != null) {
        result = await bridge.call("delayArmy", {
          armyId: cmd.army,
          minutes: target.minutes ?? 30,
          syncArrival: !!target.syncArrival,
        });
      } else if (cmd.action === "constructBuilding") {
        result = await bridge.call("constructBuilding", {
          provinceIdOrName: target.provinceIdOrName,
          upgradeId: target.upgradeId,
        });
      } else if (cmd.action === "hold" || cmd.action === "recon") {
        result = { ok: true, note: cmd.action };
      } else {
        throw new Error(`unsupported action ${cmd.action}`);
      }

      const observed =
        typeof result === "object" && result != null
          ? (result as Record<string, unknown>)
          : { result };
      const verified =
        observed.verified === true ||
        (cmd.action !== "moveArmy" && observed.ok === true) ||
        cmd.action === "hold" ||
        cmd.action === "recon";

      const updated = await this.mark(cmd.command_id, {
        status: verified ? "verified" : "failed",
        verification: verified ? "verified" : "failed",
        observed_state: observed,
        detail: verified ? "ok" : "unverified",
      });

      await getEventBus(this.rootDir).publish(
        verified ? "MOVE_VERIFIED" : "MOVE_FAILED",
        {
          source: "command-queue",
          payload: {
            command_id: cmd.command_id,
            army: cmd.army,
            observed,
          },
        },
      );
      return updated;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const updated = await this.mark(cmd.command_id, {
        status: "failed",
        verification: "failed",
        detail,
      });
      await getEventBus(this.rootDir).publish("MOVE_FAILED", {
        source: "command-queue",
        payload: { command_id: cmd.command_id, detail },
      });
      return updated;
    }
  }
}

let queueSingleton: CommandQueue | null = null;

export function getCommandQueue(rootDir: string): CommandQueue {
  if (!queueSingleton) queueSingleton = new CommandQueue(rootDir);
  return queueSingleton;
}
