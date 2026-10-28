/**
 * mcp-supremacy — stdio MCP for Supremacy 1914 (your account via Playwright).
 *
 *   cd mcp_supremacy && npm start
 *   # HTTP (ChatGPT later): npm run start:http
 *
 * Env: see .env.example (S1914_EMAIL/PASSWORD, S1914_MCP_WRITES, S1914_CDP_URL, …)
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameSession } from "./session.js";
import { dispatchTool, listToolDefs } from "./rpc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env"), override: true });
loadDotenv({ override: true });

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

const session = new GameSession();

function send(msg: JsonRpc): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
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
          serverInfo: { name: "mcp-supremacy", version: "0.1.0" },
        },
      });
      return;
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return;
    }
    if (method === "tools/list") {
      const tools = listToolDefs().map((t) => ({
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
      const result = await dispatchTool(session, name, args);
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
    `mcp-supremacy stdio ready (writes=${process.env.S1914_MCP_WRITES === "1" ? "on" : "off"})\n`,
  );

  const shutdown = async () => {
    try {
      await session.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

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
