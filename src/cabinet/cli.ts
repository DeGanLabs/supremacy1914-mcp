/**
 * Direct e2e harness — NVIDIA + browser bridge, no Telegram required.
 *
 *   npm run cabinet:cli
 *   npm run cabinet:cli -- --watch
 *   npm run cabinet:cli -- "@War war picture: wars, HIGH watch, nearby, spies"
 *
 * Keep game tab open with s1914.connectCabinetBridge(url, token) first.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadCabinetEnv, createNvidia } from "./config.js";
import { CabinetMemory } from "./memory.js";
import { SeatRegistry } from "./seats.js";
import { BrowserBridgeServer } from "../sensor/bridge-client.js";
import { ScopeToolGateway } from "../sensor/gateway.js";
import { CabinetChief } from "./chief.js";
import { redactSecrets } from "./redact.js";
import { resolveBridgeToken } from "./bridge-token.js";
import {
  fetchAndScoreOnce,
  formatWarBoard,
  startWarWatch,
} from "./war-loop.js";

async function waitForBridge(
  bridge: BrowserBridgeServer,
  timeoutMs = 90_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (bridge.isHealthy()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return bridge.isHealthy();
}

function printTurn(
  label: string,
  turn: Awaited<ReturnType<CabinetChief["handleUserMessage"]>>,
): void {
  console.log("\n" + "=".repeat(64));
  console.log(`ASK: ${label}`);
  console.log("=".repeat(64));
  if (turn.note) console.log(`note: ${turn.note}`);
  if (turn.bridgeDown) console.log("bridge: DOWN");
  for (const line of turn.publicLines) {
    console.log(`\nPUBLIC:\n${line}`);
  }
  if (turn.plan) {
    console.log("\nPLAN:", turn.plan.id);
    console.log("goal:", turn.plan.goalSummary);
    console.log("tasks:", JSON.stringify(turn.plan.tasks, null, 2));
  } else {
    console.log("\nPLAN: (none — advisory / Q&A)");
  }
}

async function main(): Promise<void> {
  const flags = new Set(
    process.argv.slice(2).filter((a) => a.startsWith("-")),
  );
  const watchMode = flags.has("--watch");
  const argvAsks = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("-"));

  const env = loadCabinetEnv({ requireTelegram: false });
  console.log(
    `cabinet CLI — ws://${env.wsHost}:${env.wsPort} (no Telegram required)${watchMode ? " --watch" : ""}`,
  );

  const memory = new CabinetMemory(env.dataDir);
  await memory.init();

  const nvidia = createNvidia(env);
  const smoke = await nvidia.smoke();
  console.log(`nvidia smoke: ${smoke.ok ? "ok" : "weak"} (${smoke.model})`);

  const bridgeToken = resolveBridgeToken(env.bridgeToken, env.dataDir);
  const bridge = new BrowserBridgeServer(
    env.wsHost,
    env.wsPort,
    20000,
    bridgeToken,
    env.wsHost === "127.0.0.1" || env.wsHost === "localhost",
  );
  bridge.start();
  console.log("bridge listening — game tab must run the connectCabinetBridge line below");
  console.log(
    `s1914.connectCabinetBridge("ws://${env.wsHost}:${env.wsPort}", "${bridgeToken}")`,
  );
  console.log("waiting for bridge…");

  let up = await waitForBridge(bridge, 120_000);
  while (!up) {
    console.warn(
      "bridge still DOWN — in the game tab run the connectCabinetBridge line printed above  (waiting…)",
    );
    up = await waitForBridge(bridge, 60_000);
  }
  const st = bridge.getStatus();
  console.log(
    `bridge UP gameId=${st.gameId} playerId=${st.playerId} heartbeat=${
      st.lastHeartbeatAt ? new Date(st.lastHeartbeatAt).toISOString() : "—"
    }`,
  );

  const gateway = new ScopeToolGateway(bridge);
  const seats = new SeatRegistry();
  const chief = new CabinetChief(nvidia, memory, seats, gateway);

  // Raw war picture + score (no LLM)
  try {
    const snap = await fetchAndScoreOnce(gateway, memory);
    console.log("\nWAR BOARD:\n" + formatWarBoard(snap));
    console.log(
      `\ntriggers(${snap.triggers.length}):`,
      snap.triggers.map((t) => t.kind).join(", ") || "none",
    );
  } catch (err) {
    console.warn(
      "get_war_picture failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const defaultAsks = [
    "@War war picture: wars, HIGH watch zones, nearby stacks, spies — threat board + intent",
  ];
  const asks = argvAsks.length ? argvAsks : watchMode ? [] : defaultAsks;

  for (const ask of asks) {
    const turn = await chief.handleUserMessage(ask);
    printTurn(ask, turn);
  }

  if (watchMode) {
    console.log(
      `\nwar-watch every ${env.warWatchMs}ms — Ctrl+C to stop`,
    );
    const loop = startWarWatch({
      bridge,
      gateway,
      memory,
      chief,
      intervalMs: env.warWatchMs,
      enabled: true,
      autoReinforce: env.warAutoReinforce,
      onAlert: ({ digest, critical, level, line, escalateAll, board }) => {
        if (digest) {
          console.log(`[war-alert/digest] ${digest.slice(0, 160)}`);
        }
        for (const ping of critical ?? []) {
          console.log(`[war-alert/critical/${level}] ${ping.slice(0, 160)}`);
        }
        if (board) console.log(board);
        if (!digest && !critical?.length) {
          console.log(
            `[war-alert/${level}${escalateAll ? "/@all" : ""}] ${line}`,
          );
        }
      },
      onHandoff: ({ seat, line }) => {
        console.log(`[war-handoff/@${seat}] ${line}`);
      },
    });

    if (process.stdin.isTTY) {
      const rl = createInterface({ input, output });
      console.log("Interactive — type @War / …  (quit to exit)");
      for (;;) {
        const line = (await rl.question("> ")).trim();
        if (!line || /^q(uit)?$/i.test(line)) break;
        if (line === "/war" || line === "/war board") {
          const snap = await memory.loadWarPicture();
          if (!snap) console.log("no snapshot");
          else if (line.includes("board")) {
            console.log(
              formatWarBoard(
                snap as import("./war-types.js").WarWatchSnapshot,
              ),
            );
          } else console.log(await memory.loadWarBrief());
          continue;
        }
        const turn = await chief.handleUserMessage(line);
        printTurn(line, turn);
      }
      rl.close();
      loop.stop();
    } else {
      await new Promise(() => undefined);
    }
  } else if (process.stdin.isTTY && !argvAsks.length) {
    const rl = createInterface({ input, output });
    console.log(
      "\nInteractive — type @Finance / @War / …  (empty or quit to exit)",
    );
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line || /^q(uit)?$/i.test(line)) break;
      const turn = await chief.handleUserMessage(line);
      printTurn(line, turn);
    }
    rl.close();
  }

  bridge.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(redactSecrets(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
