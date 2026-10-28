import "dotenv/config";
import { loadCabinetEnv } from "../src/cabinet/config.js";
import { createNvidia } from "../src/cabinet/config.js";
import { CabinetMemory } from "../src/cabinet/memory.js";
import { SeatRegistry } from "../src/cabinet/seats.js";
import { MinisterAgent } from "../src/cabinet/minister.js";
import { BrowserBridgeServer } from "../src/sensor/bridge-client.js";
import { ScopeToolGateway } from "../src/sensor/gateway.js";
import { fetchAndScoreOnce } from "../src/cabinet/war-loop.js";
import { formatWarBriefing, standingOrdersBlock } from "../src/cabinet/war-brief.js";
import { COST_CAPS } from "../src/cabinet/cost-caps.js";
import { MinisterOutputSchema } from "../src/cabinet/types.js";
import { resolveBridgeToken } from "../src/cabinet/bridge-token.js";

async function waitForBridge(
  bridge: BrowserBridgeServer,
  ms: number,
): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (bridge.isHealthy()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return bridge.isHealthy();
}

async function main() {
  const env = loadCabinetEnv({ requireTelegram: false });
  const memory = new CabinetMemory(env.dataDir);
  await memory.init();
  const nvidia = createNvidia(env);
  const bridgeToken = resolveBridgeToken(env.bridgeToken, env.dataDir);
  const bridge = new BrowserBridgeServer(
    env.wsHost,
    env.wsPort,
    20000,
    bridgeToken,
    env.wsHost === "127.0.0.1" || env.wsHost === "localhost",
  );
  bridge.start();
  console.log(
    `s1914.connectCabinetBridge("ws://${env.wsHost}:${env.wsPort}", "${bridgeToken}")`,
  );
  const up = await waitForBridge(bridge, 120_000);
  if (!up) {
    console.error("bridge down");
    process.exit(1);
  }
  const gateway = new ScopeToolGateway(bridge);
  const seats = new SeatRegistry();
  const seat = seats.get("war")!;
  const snap = await fetchAndScoreOnce(gateway, memory);
  const sharedWarPicture = formatWarBriefing(
    snap,
    snap.picture,
    COST_CAPS.maxWarBriefChars,
  );
  const goals = await memory.getGoals();
  const goalsBlock = await memory.goalsBlock();
  const standingWarOrders = standingOrdersBlock(goals);
  const question =
    "@War Russian Alaska front ONLY. List troops + Russian stacks. INTENT=hold/disengage — retreat MOST, thin screen on border. moveArmy with real ids/coords. Proposals for /approve.";

  const minister = new MinisterAgent(nvidia, gateway, seats);
  const system = `${await seats.loadPrompt(seat)}\n\nRespond with JSON MinisterOutput.`;
  let user = `Standing goals:\n${goalsBlock}\n\nPlayer question:\n${question}\n\nStanding war orders:\n${standingWarOrders}\n\nLive war picture:\n${sharedWarPicture}\n\nRespond with JSON.`;

  for (let attempt = 0; attempt < 4; attempt++) {
    console.log(`\n--- attempt ${attempt + 1} tier=quality ---`);
    const raw = await nvidia.chat({ tier: "quality", system, user, json: true });
    console.log("RAW length:", raw.length);
    console.log("RAW tail:", raw.slice(-200));
    try {
      const parsed = JSON.parse(raw);
      const out = MinisterOutputSchema.safeParse(parsed);
      if (out.success) {
        console.log("OK:", JSON.stringify(out.data, null, 2).slice(0, 2000));
        process.exit(0);
      }
      console.log("SCHEMA FAIL:", out.error.message);
      user += `\n\nSchema error: ${out.error.message}. Fix and return JSON only.`;
    } catch (e) {
      console.log("JSON PARSE FAIL:", e);
      user += `\n\nInvalid JSON. Return valid JSON only.`;
    }
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
