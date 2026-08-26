#!/usr/bin/env node
/**
 * Serve browser-console.js for game-tab fetch+eval (CORS).
 *   npm run cabinet:serve
 * Then in game DevTools:
 *   fetch("http://127.0.0.1:9878/browser-console.js").then(r=>r.text()).then(c=>{eval(c);s1914.connectCabinetBridge("ws://127.0.0.1:8765", TOKEN)})
 *
 * GET /bridge-token is loopback-only and only reflects Origin of the live game
 * (or no Origin, for curl). Start `npm run cabinet` first so the token file exists.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

loadDotenv({ override: true });

const PORT = Number(process.env.CABINET_CONSOLE_PORT || 9878);
const HOST = process.env.CABINET_CONSOLE_HOST || "127.0.0.1";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consolePath = resolve(root, "src/examples/browser-console.js");
const dataDir = process.env.CABINET_DATA_DIR?.trim() || join(root, "data", "cabinet");

function readToken() {
  const envTok = process.env.CABINET_BRIDGE_TOKEN?.trim() || "";
  if (envTok.length >= 8) return envTok;
  try {
    const t = readFileSync(join(dataDir, "bridge.token"), "utf8").trim();
    return t.length >= 8 ? t : "";
  } catch {
    return "";
  }
}

function originAllowed(origin) {
  if (!origin) return true;
  return /^(https?:\/\/(.*\.)?(supremacy1914\.com|bytro\.com)(:\d+)?)$/i.test(
    origin,
  );
}

const server = createServer((req, res) => {
  const origin = req.headers.origin || "";
  const path = (req.url || "/").split("?")[0];
  const isToken = path === "/bridge-token";

  if (isToken) {
    if (originAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin || "http://127.0.0.1");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(originAllowed(origin) ? 204 : 403);
      res.end();
      return;
    }
    if (!originAllowed(origin)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden origin\n");
      return;
    }
    const token = readToken();
    if (!token) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("no token — start npm run cabinet first\n");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(token);
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (path === "/" || path === "/browser-console.js") {
    let js;
    try {
      js = readFileSync(consolePath);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(err));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(js);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found — use /browser-console.js\n");
});

server.listen(PORT, HOST, () => {
  console.log(
    `browser-console served at http://${HOST}:${PORT}/browser-console.js (CORS *)`,
  );
  console.log(
    `bridge token at http://${HOST}:${PORT}/bridge-token (game Origin / curl only)`,
  );
});
