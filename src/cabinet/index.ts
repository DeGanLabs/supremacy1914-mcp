import { loadCabinetEnv, createNvidia } from "./config.js";
import { CabinetMemory } from "./memory.js";
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

async function main(): Promise<void> {
  const env = loadCabinetEnv();
  console.log(
    `cabinet boot on feat/ai-cabinet — ws://${env.wsHost}:${env.wsPort}`,
  );

  const memory = new CabinetMemory(env.dataDir);
  await memory.init();

  const bus = getEventBus(env.dataDir);
  const queue = getCommandQueue(env.dataDir);
  await queue.load();
  await trimEventLog(env.dataDir);
  void bus.publish("SYSTEM", {
    source: "index",
    payload: { boot: true },
  });

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

  const bridgeToken = resolveBridgeToken(env.bridgeToken, env.dataDir);
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
        await queue.executeNext(bridge);
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
  const chief = new CabinetChief(nvidia, memory, seats, gateway);
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
    dataDir: env.dataDir,
    ownerOnlySensors: env.telegramOwnerOnlySensors,
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
    onAlert: async ({ digest, level, line, board }) => {
      console.log(`[war-alert/${level}] ${(digest || line).slice(0, 120)}`);
      try {
        const body = digest || line;
        if (body) {
          await bot.api.sendMessage(
            env.telegramChatId,
            `@War ${body}`.slice(0, 3500),
          );
        }
        if (board) {
          await bot.api.sendMessage(
            env.telegramChatId,
            board.slice(0, 3500),
          );
        }
      } catch (err) {
        console.warn(
          "war-alert telegram failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    onHandoff: async ({ seat, line }) => {
      const tag =
        seat === "foreign"
          ? "@Foreign"
          : seat === "finance"
            ? "@Finance"
            : "@Intel";
      const msg = `${tag} handoff: ${line}`.slice(0, 3500);
      console.log(`[war-handoff] ${msg}`);
      try {
        await bot.api.sendMessage(env.telegramChatId, msg);
      } catch {
        /* ignore */
      }
    },
  });

  // Optional FCC finance watch (same bridge); picture at data/cabinet/finance-picture.json
  let financeWatchStop: (() => void) | undefined;
  try {
    const { FinanceMemory } = await import("../finance/memory.js");
    const { startFinanceWatch } = await import("../finance/watch.js");
    const { startFinanceHttpServer } = await import("../finance/server.js");
    const finMem = new FinanceMemory(env.dataDir);
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

  await bot.api.sendMessage(
    env.telegramChatId,
    [
      "🏛️ cabinet online (server = brain · browser = actuator)",
      "Menu: /home · /advisor · /heroes · /groups · /market · /auto · /mode · /status",
    ].join("\n"),
  );

  const shutdown = () => {
    watch.stop();
    financeWatchStop?.();
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
