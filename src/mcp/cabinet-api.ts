import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BrowserBridgeServer } from "../sensor/bridge-client.js";
import type { ScopeToolGateway } from "../sensor/gateway.js";
import type { CabinetMemory } from "../cabinet/memory.js";
import type { CabinetChief } from "../cabinet/chief.js";
import type { GameSession } from "../cabinet/session.js";
import { SENSOR_TOOLS, PHASE1_ACTION_METHODS, isSensorTool } from "../sensor/tools.js";
import { DEFAULT_SEAT_SCOPES } from "../cabinet/cost-caps.js";
import type { SensorToolName } from "../cabinet/cost-caps.js";
import { formatWarSituationAnswer } from "../cabinet/war-brief.js";

export interface CabinetApiOptions {
  readonly bridge: BrowserBridgeServer;
  readonly gateway: ScopeToolGateway;
  readonly memory: CabinetMemory;
  readonly chief: CabinetChief;
  readonly session: GameSession;
  readonly port: number;
  readonly token: string;
  /** When false, mutating tools are rejected. */
  readonly allowWrites: boolean;
}

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const ALL_SCOPES = (DEFAULT_SEAT_SCOPES.mcp ??
  Object.values(DEFAULT_SEAT_SCOPES).flat()) as SensorToolName[];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(raw);
}

function authOk(req: IncomingMessage, token: string): boolean {
  if (!token) return true;
  const h = req.headers.authorization || "";
  if (h === `Bearer ${token}` || h === token) return true;
  const q = new URL(req.url || "/", "http://127.0.0.1").searchParams.get("token");
  return q === token;
}

export function listMcpTools(): ToolDef[] {
  const sensorTools: ToolDef[] = Object.entries(SENSOR_TOOLS).map(
    ([name, meta]) => ({
      name,
      description: meta.description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          (meta.requiresArgs ?? []).map((a) => [
            a.split("|")[0],
            { type: "string" },
          ]),
        ),
      },
    }),
  );

  return [
    {
      name: "session_info",
      description: "Active game session (gameId, nation, dataDir, bridge health)",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "health",
      description: "Bridge + session health check",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_goals",
      description: "Standing goals for the active match",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "set_goal",
      description: "Set a standing goal key/value for this match",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "list_plans",
      description: "Cabinet plans for this match",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "war_sitrep",
      description: "Deterministic sitrep from last war picture (optional nation filter in question)",
      inputSchema: {
        type: "object",
        properties: { question: { type: "string" } },
      },
    },
    {
      name: "cabinet_ask",
      description:
        "Talk as president to the cabinet (routes @War/@Finance/…). Returns minister public lines + optional plan.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          seats: {
            type: "array",
            items: { type: "string" },
            description: "Optional force seat ids e.g. war,intel",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "approve_plan",
      description: "Approve a proposed plan id (executes Phase-1 tasks via bridge)",
      inputSchema: {
        type: "object",
        properties: { planId: { type: "string" } },
        required: ["planId"],
      },
    },
    ...sensorTools,
    ...PHASE1_ACTION_METHODS.map((name) => ({
      name,
      description: `Execute ${name} on the live game (requires CAPINET_MCP_WRITES=1)`,
      inputSchema: { type: "object", additionalProperties: true },
    })),
  ];
}

export function startCabinetApi(opts: CabinetApiOptions): {
  close: () => void;
  port: number;
} {
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      });
      res.end();
      return;
    }

    if (!authOk(req, opts.token)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    const url = new URL(req.url || "/", `http://127.0.0.1:${opts.port}`);
    const pathName = url.pathname;

    try {
      if (req.method === "GET" && pathName === "/health") {
        const st = opts.bridge.getStatus();
        json(res, 200, {
          ok: true,
          bridge: opts.bridge.isHealthy(),
          session: opts.session.snapshot,
          status: st,
        });
        return;
      }

      if (req.method === "GET" && pathName === "/mcp/tools") {
        json(res, 200, { tools: listMcpTools() });
        return;
      }

      if (req.method === "POST" && pathName === "/mcp/call") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const name = body.name || "";
        const args = body.arguments ?? {};
        const result = await dispatchTool(opts, name, args);
        json(res, 200, { ok: true, result });
        return;
      }

      json(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      json(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(
      `cabinet API http://127.0.0.1:${opts.port} (MCP tools /mcp/tools · /mcp/call)`,
    );
  });

  return {
    port: opts.port,
    close: () => server.close(),
  };
}

async function dispatchTool(
  opts: CabinetApiOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === "session_info" || name === "health") {
    return {
      session: opts.session.snapshot,
      bridge: opts.bridge.getStatus(),
      healthy: opts.bridge.isHealthy(),
      prompt: opts.session.sessionPromptBlock(),
    };
  }
  if (name === "list_goals") {
    return opts.memory.getGoals();
  }
  if (name === "set_goal") {
    if (!opts.allowWrites) throw new Error("writes disabled (CABINET_MCP_WRITES=0)");
    const key = String(args.key || "");
    const value = String(args.value || "");
    if (!key) throw new Error("key required");
    return opts.memory.setGoal(key, value);
  }
  if (name === "list_plans") {
    return opts.memory.getPlans();
  }
  if (name === "war_sitrep") {
    const snap = (await opts.memory.loadWarPicture()) as Parameters<
      typeof formatWarSituationAnswer
    >[0];
    const q = String(args.question || "sitrep");
    return {
      line: formatWarSituationAnswer(snap, q),
      session: opts.session.snapshot,
    };
  }
  if (name === "cabinet_ask") {
    const text = String(args.text || "").trim();
    if (!text) throw new Error("text required");
    const seats = Array.isArray(args.seats)
      ? args.seats.map(String)
      : undefined;
    return opts.chief.handleUserMessage(text, {
      continueConversation: true,
      forceSeatIds: seats,
      singleAdvisor: seats?.length === 1,
    });
  }
  if (name === "approve_plan") {
    if (!opts.allowWrites) throw new Error("writes disabled");
    const planId = String(args.planId || "");
    const plan = await opts.memory.getPlan(planId);
    if (!plan) throw new Error(`plan not found: ${planId}`);
    // Mark approved — actual execute stays on Telegram executor path for safety.
    plan.status = "approved";
    await opts.memory.savePlan(plan);
    return { ok: true, planId, note: "marked approved — run via Telegram /approve to execute" };
  }

  if (isSensorTool(name)) {
    if (!opts.bridge.isHealthy()) throw new Error("game not connected");
    opts.gateway.resetTurn("mcp");
    return opts.gateway.call("mcp", ALL_SCOPES, name, args);
  }

  if ((PHASE1_ACTION_METHODS as readonly string[]).includes(name)) {
    if (!opts.allowWrites) throw new Error("writes disabled (CABINET_MCP_WRITES=0)");
    if (!opts.bridge.isHealthy()) throw new Error("game not connected");
    return opts.bridge.call(name, args);
  }

  throw new Error(`unknown tool: ${name}`);
}
