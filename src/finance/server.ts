import type { BrowserBridgeServer } from "../sensor/bridge-client.js";
import type { FinanceMemory } from "./memory.js";
import { buildFinancePicture } from "./build-picture.js";
import { simulateWhatIf } from "./format.js";
import type { FinanceMode, WhatIfInput } from "./types.js";
import { collectRawFinanceInput, startFinanceWatch } from "./watch.js";
import type { ScopeToolGateway } from "../sensor/gateway.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import http from "node:http";

export interface FinanceServerDeps {
  readonly memory: FinanceMemory;
  readonly bridge: BrowserBridgeServer;
  readonly gateway: ScopeToolGateway;
  readonly watch: ReturnType<typeof startFinanceWatch>;
  readonly port: number;
  readonly getMode: () => FinanceMode;
  readonly setMode: (m: FinanceMode) => void;
}

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function startFinanceHttpServer(deps: FinanceServerDeps): http.Server {
  const server = http.createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://127.0.0.1:${deps.port}`);

    try {
      if (url.pathname === "/api/finance-picture" && req.method === "GET") {
        let pic = await deps.memory.loadFinancePicture();
        if (!pic && deps.bridge.isHealthy()) {
          pic = await deps.watch.tickNow();
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pic));
        return;
      }

      if (url.pathname === "/api/finance-refresh" && req.method === "POST") {
        const pic = await deps.watch.tickNow();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pic));
        return;
      }

      if (url.pathname === "/api/finance-mode" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as { mode?: FinanceMode };
        if (
          body.mode === "economy" ||
          body.mode === "warEconomy" ||
          body.mode === "emergency"
        ) {
          deps.setMode(body.mode);
          const pic = await deps.watch.tickNow();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(pic));
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad mode" }));
        return;
      }

      if (url.pathname === "/api/war-demand" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        const list = Array.isArray(body) ? body : body.warDemand ?? [];
        await deps.memory.saveWarDemand(list);
        const pic = await deps.watch.tickNow();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pic));
        return;
      }

      if (url.pathname === "/api/what-if" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as WhatIfInput;
        let pic = await deps.memory.loadFinancePicture();
        if (!pic) {
          pic = await deps.watch.tickNow();
        }
        if (!pic) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "no picture" }));
          return;
        }
        const result = simulateWhatIf(pic, body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (url.pathname === "/api/approve-build" && req.method === "POST") {
        if (!deps.bridge.isHealthy()) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "game not connected" }));
          return;
        }
        const body = JSON.parse(await readBody(req)) as {
          provinceIdOrName?: string;
          upgradeId?: number;
        };
        if (!body.provinceIdOrName || body.upgradeId == null) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "provinceIdOrName and upgradeId required" }));
          return;
        }
        let result: unknown;
        try {
          result = await deps.bridge.call("constructBuilding", {
            provinceIdOrName: body.provinceIdOrName,
            upgradeId: body.upgradeId,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: msg }));
          return;
        }
        await deps.memory.appendEvent(
          `Approved build ${body.upgradeId} @ ${body.provinceIdOrName}`,
          body.provinceIdOrName,
        );
        // Let the client settle costs, then resync picture for next approve step
        await new Promise((r) => setTimeout(r, 600));
        const picture = await deps.watch.tickNow();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result, picture }));
        return;
      }

      if (url.pathname === "/api/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            bridge: deps.bridge.isHealthy(),
            mode: deps.getMode(),
            hasPicture: !!(await deps.memory.loadFinancePicture()),
          }),
        );
        return;
      }

      // static fixture for offline UI
      if (url.pathname === "/api/fixture") {
        const fixturePath = path.join(
          process.cwd(),
          "src/finance/fixtures/sample-picture.json",
        );
        try {
          const raw = await readFile(fixturePath, "utf8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(raw);
        } catch {
          const raw = await collectRawFinanceInput(deps.bridge, deps.gateway, {
            mode: deps.getMode(),
          }).catch(() => null);
          if (raw) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(buildFinancePicture(raw)));
            return;
          }
          res.writeHead(404);
          res.end("no fixture");
        }
        return;
      }

      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  server.listen(deps.port, "127.0.0.1", () => {
    console.log(`finance API http://127.0.0.1:${deps.port}`);
  });
  return server;
}
