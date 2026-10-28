import { loadCabinetEnv, createNvidia } from "./config.js";
import { SeatRegistry } from "./seats.js";
import { BrowserBridgeServer } from "../sensor/bridge-client.js";
import { ScopeToolGateway } from "../sensor/gateway.js";
import { CabinetChief } from "./chief.js";
import { CabinetExecutor } from "./executor.js";
import { startTelegramBot } from "./telegram.js";
import { startWarWatch } from "./war-loop.js";
import { redactSecrets } from "./redact.js";
import { resolveBridgeToken } from "./bridge-token.js";
import { getEventBus, trimEventLog } from "./events.js";
import { getCommandQueue } from "./command-queue.js";
import { GameSession } from "./session.js";
import { startCabinetApi } from "../mcp/cabinet-api.js";

async function main(): Promise<void> {
  const env = loadCabinetEnv();
  console.log(
    `cabinet boot on feat/ai-cabinet — ws://${env.wsHost}:${env.wsPort}`,
  );

  const session = new GameSession(env.dataDir);
  await session.init();
  const memory = session.memory;
  const baseDir = session.baseDataDir;

  const bus = getEventBus(session.dataDir);
  const queue = getCommandQueue(session.dataDir);
  await queue.load();
  await trimEventLog(session.dataDir);
  void bus.publish("SYSTEM", {
    source: "index",
    payload: { boot: true, gameId: session.snapshot.activeGameId },
  });
  // Drop Africa (etc.) goals that don't match the live picture on boot.
  await session.scrubStaleGoals();

  const nvidia = createNvidia(env);
  try {
    const smoke = await nvidia.smoke();
    console.log(`nvidia smoke: ${smoke.ok ? "ok" : "weak"} (${smoke.model})`);
  } catch (err) {
    const msg = redactSecrets(err instanceof Error ? err.message : String(err));
    console.error("nvidia smoke failed:", msg);
    if (/429|Too Many Requests/i.test(msg)) {
      console.warn("continuing boot — NVIDIA rate-limited the smoke check");
    } else {
      process.exit(1);
    }
  }

  const bridgeToken = resolveBridgeToken(env.bridgeToken, baseDir);
  const bridge = new BrowserBridgeServer(
    env.wsHost,
    env.wsPort,
    20000,
    bridgeToken,
    env.wsHost === "127.0.0.1" || env.wsHost === "localhost",
  );
  bridge.start();
  console.log("bridge listening — paste browser-console.js in open game tab");
  console.log(
    `then run: s1914.connectCabinetBridge("ws://${env.wsHost}:${env.wsPort}", "${bridgeToken}")`,
  );
  console.log("or: npm run cabinet:keep (CDP inject + reconnect)");

  setTimeout(() => {
    if (!bridge.isHealthy()) {
      console.warn(
        "WARN: game bridge not connected yet — Telegram will reply 'game not connected' until you paste the console bridge",
      );
    }
  }, 5000);

  // Dedicated command-queue pump (delayed not_before / retries)
  const queueTimer = setInterval(() => {
    void (async () => {
      if (!bridge.isHealthy() || queue.isPaused()) return;
      try {
        const q = getCommandQueue(session.dataDir);
        await q.load();
        await q.executeNext(bridge);
      } catch (err) {
        console.warn(
          "[command-queue]",
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, 8_000);

  const gateway = new ScopeToolGateway(bridge);
  const seats = new SeatRegistry();
  await seats.loadOverrides(baseDir);
  const chief = new CabinetChief(nvidia, memory, seats, gateway, session);
  const executor = new CabinetExecutor(
    bridge,
    memory,
    env.telegramQuietApprove,
  );

  const bot = startTelegramBot({
    token: env.telegramBotToken,
    chatId: env.telegramChatId,
    ownerUserId: env.telegramUserId,
    quietApprove: env.telegramQuietApprove,
    chief,
    memory,
    executor,
    bridge,
    seats,
    nvidia,
    dataDir: baseDir,
    getDataDir: () => session.dataDir,
    ownerOnlySensors: env.telegramOwnerOnlySensors,
  });

  bridge.onHello(async ({ gameId, playerId }) => {
    let nation: string | null = null;
    try {
      const pic = (await bridge.call("get_war_picture", {})) as {
        myNation?: string;
      };
      nation = pic?.myNation ?? null;
    } catch {
      /* picture optional on hello */
    }
    const result = await session.onBridgeHello({
      gameId,
      playerId,
      nation,
    });
    await session.scrubStaleGoals();
    if (result.message) {
      try {
        const { sendInTopic } = await import("./telegram-topics.js");
        await sendInTopic(
          bot.api,
          env.telegramChatId,
          baseDir,
          "general",
          result.message,
          { parse_mode: "Markdown" },
        );
      } catch {
        await bot.api
          .sendMessage(env.telegramChatId, result.message)
          .catch(() => undefined);
      }
    }
    // First picture for the new match
    try {
      const { fetchAndScoreOnce } = await import("./war-loop.js");
      await fetchAndScoreOnce(gateway, memory);
    } catch (err) {
      console.warn(
        "[session] initial war picture:",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  const apiPort = Number(process.env.CABINET_API_PORT || 8766);
  const apiToken =
    process.env.CABINET_API_TOKEN?.trim() || bridgeToken;
  const api = startCabinetApi({
    bridge,
    gateway,
    memory,
    chief,
    session,
    port: apiPort,
    token: apiToken,
    allowWrites: process.env.CABINET_MCP_WRITES === "1",
  });

  bot.catch((err) => {
    console.error(
      "telegram error:",
      redactSecrets(err instanceof Error ? err.message : String(err)),
    );
  });

  const watch = startWarWatch({
    bridge,
    gateway,
    memory,
    chief,
    intervalMs: env.warWatchMs,
    enabled: env.warWatch,
    autoReinforce: env.warAutoReinforce,
    onAlert: async ({ digest, level, line, parts, board }) => {
      console.log(`[war-alert/${level}] ${(digest || line).slice(0, 120)}`);
      try {
        const { sendInTopic } = await import("./telegram-topics.js");
        const bubbles =
          parts && parts.length
            ? [...parts]
            : [digest || line, board].filter(Boolean);
        // Separate short bubbles — never one mega-batch
        for (let i = 0; i < bubbles.length; i++) {
          const body = String(bubbles[i]).slice(0, 1200);
          if (!body.trim()) continue;
          await sendInTopic(
            bot.api,
            env.telegramChatId,
            baseDir,
            "war",
            body,
            { parse_mode: "Markdown" },
          );
          if (i < bubbles.length - 1) {
            await new Promise((r) => setTimeout(r, 350));
          }
        }
      } catch (err) {
        console.warn(
          "war-alert telegram failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    onHandoff: async ({ seat, line }) => {
      const key =
        seat === "foreign"
          ? "foreign"
          : seat === "finance"
            ? "finance"
            : "intel";
      const tag =
        seat === "foreign"
          ? "🤝 Foreign"
          : seat === "finance"
            ? "💰 Finance"
            : "🕵️ Intel";
      const msg = `${tag} handoff:\n${line}`.slice(0, 3500);
      console.log(`[war-handoff] ${msg}`);
      try {
        const { sendInTopic } = await import("./telegram-topics.js");
        await sendInTopic(bot.api, env.telegramChatId, baseDir, key, msg);
      } catch {
        /* ignore */
      }
    },
  });

  // Optional FCC finance watch (same bridge); picture under match-scoped dir
  let financeWatchStop: (() => void) | undefined;
  try {
    const { FinanceMemory } = await import("../finance/memory.js");
    const { startFinanceWatch } = await import("../finance/watch.js");
    const { startFinanceHttpServer } = await import("../finance/server.js");
    const finMem = new FinanceMemory(session.dataDir);
    await finMem.init();
    let finMode: import("../finance/types.js").FinanceMode = "economy";
    const finWatch = startFinanceWatch({
      bridge,
      gateway,
      memory: finMem,
      intervalMs: Number(process.env.FINANCE_WATCH_MS || 120_000),
      enabled: process.env.FINANCE_WATCH !== "0",
      getMode: () => finMode,
    });
    financeWatchStop = finWatch.stop;
    startFinanceHttpServer({
      memory: finMem,
      bridge,
      gateway,
      watch: finWatch,
      port: Number(process.env.FINANCE_API_PORT || 8787),
      getMode: () => finMode,
      setMode: (m) => {
        finMode = m;
      },
    });
  } catch (err) {
    console.warn(
      "finance watch skipped:",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    const { ensureCabinetTopics, sendInTopic } = await import(
      "./telegram-topics.js"
    );
    const topics = await ensureCabinetTopics(
      bot.api,
      env.telegramChatId,
      baseDir,
    );
    const sess = session.snapshot;
    await sendInTopic(
      bot.api,
      env.telegramChatId,
      baseDir,
      "general",
      [
        "🏛️ *Presidential Cabinet — online*",
        sess.activeGameId
          ? `Match \`${sess.activeGameId}\`${sess.nation ? ` · ${sess.nation}` : ""}`
          : "Waiting for bridge hello to bind match memory",
        topics.isForum
          ? "🧵 Seat threads ready — talk in ⚔️ War / 💰 Finance / …"
          : "Enable *Topics* on this group, then /topics setup",
        "You approve · they move. /home · /topics · /status",
        `MCP API :${apiPort} · \`npm run mcp\``,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    console.warn(
      "telegram boot message:",
      err instanceof Error ? err.message : String(err),
    );
    await bot.api.sendMessage(
      env.telegramChatId,
      "🏛️ cabinet online — /home · /topics setup · /status",
    );
  }

  const shutdown = () => {
    watch.stop();
    financeWatchStop?.();
    api.close();
    clearInterval(queueTimer);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) =>
      console.log(
        `telegram bot started (@${info.username}) warWatch=${env.warWatch} every ${env.warWatchMs}ms`,
      ),
  });
}

main().catch((err) => {
  console.error(redactSecrets(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
