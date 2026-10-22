/**
 * MCP stdio server — exposes cabinet tools to Cursor / Claude Desktop / any MCP client.
 *
 * Requires cabinet running (HTTP API). Default: http://127.0.0.1:8766
 *
 *   npm run cabinet          # boots API
 *   npm run mcp              # stdio MCP proxy
 *
 * Env:
 *   CABINET_API_URL=http://127.0.0.1:8766
 *   CABINET_MCP_TOKEN=...    # same as CABINET_API_TOKEN / bridge token
 */
import { config as loadDotenv } from "dotenv";
import { listMcpTools } from "./cabinet-api.js";

loadDotenv({ override: true });

const API =
  process.env.CABINET_API_URL?.trim() || "http://127.0.0.1:8766";
const TOKEN =
  process.env.CABINET_MCP_TOKEN?.trim() ||
  process.env.CABINET_API_TOKEN?.trim() ||
  process.env.CABINET_BRIDGE_TOKEN?.trim() ||
  "";

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

function send(msg: JsonRpc): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function apiCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${API}/mcp/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ name, arguments: args }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data.result;
}

async function handle(msg: JsonRpc): Promise<void> {
  const id = msg.id ?? null;
  const method = msg.method || "";

  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "s1914-cabinet", version: "0.1.0" },
        },
      });
      return;
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return;
    }
    if (method === "tools/list") {
      const tools = listMcpTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (method === "tools/call") {
      const params = msg.params || {};
      const name = String(params.name || "");
      const args = (params.arguments || {}) as Record<string, unknown>;
      const result = await apiCall(name, args);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
      return;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function main(): Promise<void> {
  process.stderr.write(
    `s1914 MCP stdio → ${API} (token ${TOKEN ? "set" : "none"})\n`,
  );
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line) as JsonRpc;
      } catch {
        continue;
      }
      void handle(msg);
    }
  });
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
