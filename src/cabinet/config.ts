import { config as loadDotenv } from "dotenv";
import { NvidiaClient } from "./nvidia-client.js";

// Prefer repo .env over leftover shell tokens (e.g. another bot's TELEGRAM_BOT_TOKEN).
loadDotenv({ override: true });

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export interface CabinetEnv {
  readonly nvidiaApiKey: string;
  readonly nvidiaModel: string;
  readonly nvidiaModelFast: string;
  readonly nvidiaMaxTokens: number;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly telegramUserId: number;
  readonly telegramQuietApprove: boolean;
  readonly telegramOwnerOnlySensors: boolean;
  readonly wsHost: string;
  readonly wsPort: number;
  readonly bridgeToken: string;
  readonly dataDir: string;
  readonly warWatch: boolean;
  readonly warWatchMs: number;
  readonly warAutoReinforce: boolean;
}

export function loadCabinetEnv(
  opts: { readonly requireTelegram?: boolean } = {},
): CabinetEnv {
  const requireTelegram = opts.requireTelegram !== false;
  return {
    nvidiaApiKey: requireEnv("NVIDIA_API_KEY"),
    nvidiaModel:
      process.env.NVIDIA_MODEL?.trim() || "meta/llama-3.3-70b-instruct",
    nvidiaModelFast:
      process.env.NVIDIA_MODEL_FAST?.trim() || "meta/llama-3.1-8b-instruct",
    nvidiaMaxTokens: Number(process.env.NVIDIA_MAX_TOKENS || 1536),
    telegramBotToken: requireTelegram
      ? requireEnv("TELEGRAM_BOT_TOKEN")
      : process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
    telegramChatId: requireTelegram
      ? requireEnv("TELEGRAM_CHAT_ID")
      : process.env.TELEGRAM_CHAT_ID?.trim() || "",
    telegramUserId: requireTelegram
      ? Number(requireEnv("TELEGRAM_USER_ID"))
      : Number(process.env.TELEGRAM_USER_ID || 0),
    telegramQuietApprove: process.env.TELEGRAM_QUIET_APPROVE === "1",
    telegramOwnerOnlySensors: process.env.TELEGRAM_OWNER_ONLY_SENSORS !== "0",
    wsHost: process.env.CABINET_WS_HOST?.trim() || "127.0.0.1",
    bridgeToken: process.env.CABINET_BRIDGE_TOKEN?.trim() || "",
    wsPort: Number(process.env.CABINET_WS_PORT || 8765),
    dataDir: process.env.CABINET_DATA_DIR?.trim() || "data/cabinet",
    warWatch: process.env.WAR_WATCH !== "0",
    warWatchMs: Number(process.env.WAR_WATCH_MS || 300_000),
    warAutoReinforce: process.env.WAR_AUTO_REINFORCE === "1",
  };
}

export function createNvidia(env: CabinetEnv): NvidiaClient {
  return new NvidiaClient({
    apiKey: env.nvidiaApiKey,
    model: env.nvidiaModel,
    fastModel: env.nvidiaModelFast,
    maxTokens: env.nvidiaMaxTokens,
  });
}
