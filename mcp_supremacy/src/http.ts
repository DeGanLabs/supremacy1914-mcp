/**
 * HTTP API for remote agents (ChatGPT / Cursor / custom clients).
 *
 *   npm run start:http
 *   Production: docker compose --env-file .env.production up -d --build
 *
 * Endpoints:
 *   GET  /health              (public)
 *   GET  /shots/:id.png       (public, short-lived, unguessable id)
 *   GET  /mcp/tools           Bearer
 *   POST /mcp/call            Bearer  { name, arguments }
 *   POST /mcp                 Bearer  JSON-RPC
 *   GET  /openapi.json        Bearer
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { GameSession } from "./session.js";
import { dispatchTool, listToolDefs } from "./rpc.js";
import { startCampaignAutosnap } from "./history.js";
import { readShotPng, startShotGc } from "./shots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.production"), override: true });
loadDotenv({ path: path.resolve(__dirname, "../.env"), override: true });
loadDotenv({ override: true });

const PORT = Number(process.env.S1914_MCP_HTTP_PORT || 8787);
const HOST = process.env.S1914_MCP_HTTP_HOST?.trim() || "127.0.0.1";
const PUBLIC_BASE =
  process.env.S1914_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ||
  `http://${HOST}:${PORT}`;
const REQUIRE_TOKEN = process.env.S1914_MCP_REQUIRE_TOKEN === "1";
/** ChatGPT custom MCP only offers OAuth / no-auth — allow anonymous when set. Writes still need S1914_MCP_WRITES=1. */
const ALLOW_ANON = process.env.S1914_MCP_ALLOW_ANON === "1";
const VERSION = "0.3.1";


function resolveToken(): string {
  const env = process.env.S1914_MCP_TOKEN?.trim() || "";
  if (env.length >= 16) return env;
  if (REQUIRE_TOKEN || process.env.NODE_ENV === "production") {
    throw new Error(
      "S1914_MCP_TOKEN required (min 16 chars) when S1914_MCP_REQUIRE_TOKEN=1 or NODE_ENV=production",
    );
  }
  const generated = randomBytes(16).toString("hex");
  process.stderr.write(
    `[mcp-supremacy http] S1914_MCP_TOKEN not set — generated for this process: ${generated}\n`,
  );
  return generated;
}

const TOKEN = resolveToken();
const session = new GameSession();
startShotGc();
startCampaignAutosnap(
  () => session.isBusy(),
  () => dispatchTool(session, "campaign_snapshot", {}),
);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
  });
  res.end(raw);
}

function authOk(req: IncomingMessage): boolean {
  if (ALLOW_ANON) return true;
  const h = req.headers.authorization || "";
  if (h === `Bearer ${TOKEN}` || h === TOKEN) return true;
  try {
    const url = new URL(req.url || "/", PUBLIC_BASE);
    if (url.searchParams.get("token") === TOKEN) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function textResult(result: unknown): {
  content: { type: string; text: string }[];
} {
  return {
    content: [
      {
        type: "text",
        text:
          typeof result === "string" ? result : JSON.stringify(result, null, 2),
      },
    ],
  };
}

const startedAt = Date.now();

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || "/", PUBLIC_BASE);
  const pathName = url.pathname;

  try {
    if (req.method === "GET" && pathName === "/health") {
      json(res, 200, {
        ok: true,
        service: "mcp-supremacy",
        version: VERSION,
        publicBase: PUBLIC_BASE,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      });
      return;
    }

    // Public expiring screenshots (no Bearer — security is unguessable id + TTL)
    const shotMatch = pathName.match(/^\/shots\/([a-f0-9]{32})\.png$/i);
    if (req.method === "GET" && shotMatch) {
      const got = readShotPng(shotMatch[1]);
      if ("error" in got) {
        json(res, got.error === "gone" ? 410 : 404, {
          ok: false,
          error: got.error === "gone" ? "shot expired" : "shot not found",
        });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=60",
        "Access-Control-Allow-Origin": "*",
        "Content-Length": String(got.png.length),
      });
      res.end(got.png);
      return;
    }

    if (!authOk(req)) {
      json(res, 401, {
        ok: false,
        error: "unauthorized — Authorization: Bearer <S1914_MCP_TOKEN>",
      });
      return;
    }

    if (req.method === "GET" && pathName === "/mcp/tools") {
      json(res, 200, {
        tools: listToolDefs().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
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
      const t0 = Date.now();
      process.stderr.write(`[mcp] call ${name}\n`);
      try {
        const result = await dispatchTool(session, name, args);
        process.stderr.write(`[mcp] ok ${name} ${Date.now() - t0}ms\n`);
        json(res, 200, { ok: true, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp] ERR ${name} ${Date.now() - t0}ms ${message.slice(0, 240)}\n`);
        throw err;
      }
      return;
    }

    if (req.method === "POST" && pathName === "/mcp") {
      const raw = await readBody(req);
      const msg = JSON.parse(raw || "{}") as {
        jsonrpc?: string;
        id?: string | number | null;
        method?: string;
        params?: Record<string, unknown>;
      };
      const id = msg.id ?? null;
      const method = msg.method || "";

      if (method === "initialize") {
        json(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "mcp-supremacy", version: VERSION },
          },
        });
        return;
      }
      if (method === "tools/list") {
        json(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            tools: listToolDefs().map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        });
        return;
      }
      if (method === "tools/call") {
        const params = msg.params || {};
        const name = String(params.name || "");
        const args = (params.arguments || {}) as Record<string, unknown>;
        const t0 = Date.now();
        process.stderr.write(
          `[mcp] call ${name} args=${JSON.stringify(args).slice(0, 180)}\n`,
        );
        try {
          const result = await dispatchTool(session, name, args);
          process.stderr.write(
            `[mcp] ok ${name} ${Date.now() - t0}ms busy=${session.isBusy()} inFlight=${session.inFlightLabel() ?? "-"}\n`,
          );
          json(res, 200, {
            jsonrpc: "2.0",
            id,
            result: textResult(result),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[mcp] ERR ${name} ${Date.now() - t0}ms ${message.slice(0, 240)}\n`,
          );
          // Always HTTP 200 for JSON-RPC so ChatGPT surfaces `error.message`
          // instead of opaque "-32603 Internal error".
          json(res, 200, {
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message },
          });
        }
        return;
      }
      if (method === "ping") {
        json(res, 200, { jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (method === "notifications/initialized" || method.startsWith("notifications/")) {
        res.writeHead(202, corsHeaders());
        res.end();
        return;
      }
      if (method === "resources/list") {
        json(res, 200, { jsonrpc: "2.0", id, result: { resources: [] } });
        return;
      }
      if (method === "prompts/list") {
        json(res, 200, { jsonrpc: "2.0", id, result: { prompts: [] } });
        return;
      }
      json(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
      return;
    }

    // ChatGPT probes GET /mcp
    if (req.method === "GET" && pathName === "/mcp") {
      json(res, 200, {
        ok: true,
        service: "mcp-supremacy",
        version: VERSION,
        transport: "json-rpc",
      });
      return;
    }

    if (req.method === "GET" && pathName === "/openapi.json") {
      json(res, 200, buildOpenApi());
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

function buildOpenApi(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "mcp-supremacy",
      version: VERSION,
      description:
        "Supremacy 1914 account tools for agents (ChatGPT Actions / remote MCP).",
    },
    servers: [{ url: PUBLIC_BASE }],
    paths: {
      "/health": {
        get: {
          operationId: "health",
          summary: "Liveness (no auth)",
          responses: { "200": { description: "OK" } },
        },
      },
      "/mcp/call": {
        post: {
          operationId: "callTool",
          summary: "Call an mcp-supremacy tool",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: {
                      type: "string",
                      description:
                        "Tool name e.g. ensure_ready, get_finance_picture",
                    },
                    arguments: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Tool result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      result: {},
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/mcp/tools": {
        get: {
          operationId: "listTools",
          summary: "List tools",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Tool list" } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}

server.listen(PORT, HOST, () => {
  process.stderr.write(
    `mcp-supremacy HTTP ${PUBLIC_BASE}  (bind ${HOST}:${PORT})\n`,
  );
  process.stderr.write(
    `Auth: Authorization: Bearer ${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}\n`,
  );
});

const shutdown = async () => {
  server.close();
  await session.stop().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
