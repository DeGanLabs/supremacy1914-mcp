import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { BrowserBridgeServer } from "../sensor/bridge-client.js";
import { ScopeToolGateway } from "../sensor/gateway.js";
import { FinanceMemory } from "./memory.js";
import { startFinanceWatch } from "./watch.js";
import { startFinanceHttpServer } from "./server.js";
import type { FinanceMode } from "./types.js";
import { resolveBridgeToken } from "../cabinet/bridge-token.js";

loadDotenv({ override: true });

async function main(): Promise<void> {
  const dataDir = process.env.CABINET_DATA_DIR?.trim() || "data/cabinet";
  const wsHost = process.env.CABINET_WS_HOST?.trim() || "127.0.0.1";
  const wsPort = Number(process.env.CABINET_WS_PORT || 8765);
  const financeWatchMs = Number(process.env.FINANCE_WATCH_MS || 120000);
  const financeWatch = process.env.FINANCE_WATCH !== "0";
  const financePort = Number(process.env.FINANCE_API_PORT || 8787);

  const memory = new FinanceMemory(path.resolve(dataDir));
  await memory.init();

  let mode: FinanceMode = "economy";
  const bridgeToken = resolveBridgeToken(
    process.env.CABINET_BRIDGE_TOKEN?.trim() || "",
    dataDir,
  );
  const bridge = new BrowserBridgeServer(
    wsHost,
    wsPort,
    20000,
    bridgeToken,
    wsHost === "127.0.0.1" || wsHost === "localhost",
  );
  bridge.start();
  const gateway = new ScopeToolGateway(bridge);

  const watch = startFinanceWatch({
    bridge,
    gateway,
    memory,
    intervalMs: financeWatchMs,
    enabled: financeWatch,
    getMode: () => mode,
    onUpdate: (p) => {
      console.log(
        `[finance] health=${p.national.health.total} bottleneck=${p.national.bottleneck?.name ?? "-"} provinces=${p.provinces.length}`,
      );
    },
  });

  startFinanceHttpServer({
    memory,
    bridge,
    gateway,
    watch,
    port: financePort,
    getMode: () => mode,
    setMode: (m) => {
      mode = m;
    },
  });

  console.log(
    `finance engine — paste browser-console.js then s1914.connectCabinetBridge("ws://${wsHost}:${wsPort}", "${bridgeToken}")`,
  );
  console.log(`API: http://127.0.0.1:${financePort}/api/finance-picture`);
  console.log(`Fixture: http://127.0.0.1:${financePort}/api/fixture`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
