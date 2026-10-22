import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Api, Bot } from "grammy";

/** Logical cabinet rooms → Telegram forum topic thread ids. */
export type CabinetTopicKey =
  | "general"
  | "council"
  | "war"
  | "defense"
  | "finance"
  | "intel"
  | "foreign"
  | "approvals";

export const CABINET_TOPIC_DEFS: ReadonlyArray<{
  readonly key: CabinetTopicKey;
  readonly name: string;
  readonly seatId?: string;
  /** Full multi-minister debate + joint plan (not a single seat). */
  readonly council?: boolean;
}> = [
  { key: "general", name: "🏛️ General" },
  {
    key: "council",
    name: "🗣️ Cabinet Council",
    council: true,
  },
  { key: "war", name: "⚔️ War", seatId: "war" },
  { key: "defense", name: "🛡️ Defense", seatId: "defense" },
  { key: "finance", name: "💰 Finance", seatId: "finance" },
  { key: "intel", name: "🕵️ Intel", seatId: "intel" },
  { key: "foreign", name: "🤝 Foreign", seatId: "foreign" },
  { key: "approvals", name: "✅ Approvals" },
];

export interface TelegramTopicsState {
  readonly chatId: string;
  readonly isForum: boolean;
  readonly topics: Partial<Record<CabinetTopicKey, number>>;
  readonly updatedAt: string;
  readonly note?: string;
}

function topicsPath(dataDir: string): string {
  return path.join(dataDir, "telegram-topics.json");
}

export async function loadTopicsState(
  dataDir: string,
): Promise<TelegramTopicsState | null> {
  try {
    return JSON.parse(
      await readFile(topicsPath(dataDir), "utf8"),
    ) as TelegramTopicsState;
  } catch {
    return null;
  }
}

export async function saveTopicsState(
  dataDir: string,
  state: TelegramTopicsState,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(topicsPath(dataDir), JSON.stringify(state, null, 2), "utf8");
}

export function seatIdToTopicKey(seatId: string): CabinetTopicKey | null {
  const hit = CABINET_TOPIC_DEFS.find((d) => d.seatId === seatId);
  return hit?.key ?? null;
}

export function topicKeyForSeat(seatId: string): CabinetTopicKey {
  return seatIdToTopicKey(seatId) ?? "general";
}

export function seatIdFromThreadId(
  state: TelegramTopicsState | null | undefined,
  threadId: number | undefined,
): string | null {
  if (!state?.isForum || threadId == null) return null;
  for (const def of CABINET_TOPIC_DEFS) {
    if (def.seatId && state.topics[def.key] === threadId) return def.seatId;
  }
  return null;
}

/** True when the message is in the multi-minister Council topic. */
export function isCouncilThread(
  state: TelegramTopicsState | null | undefined,
  threadId: number | undefined,
): boolean {
  if (!state?.isForum || threadId == null) return false;
  return state.topics.council === threadId;
}

export function threadIdForKey(
  state: TelegramTopicsState | null | undefined,
  key: CabinetTopicKey,
): number | undefined {
  if (!state?.isForum) return undefined;
  return state.topics[key];
}

/**
 * Ensure forum topics exist for the war-room chat.
 * Requires the group to be a forum (Topics enabled in Telegram group settings).
 */
export async function ensureCabinetTopics(
  api: Api | Bot["api"],
  chatId: string | number,
  dataDir: string,
): Promise<TelegramTopicsState> {
  const chat = await api.getChat(chatId);
  const isForum = !!(chat as { is_forum?: boolean }).is_forum;
  const prev = await loadTopicsState(dataDir);
  const topics: Partial<Record<CabinetTopicKey, number>> = {
    ...(prev?.chatId === String(chatId) ? prev.topics : {}),
  };

  if (!isForum) {
    const state: TelegramTopicsState = {
      chatId: String(chatId),
      isForum: false,
      topics: {},
      updatedAt: new Date().toISOString(),
      note: "Enable Topics in Telegram group settings, then /topics setup",
    };
    await saveTopicsState(dataDir, state);
    return state;
  }

  // General topic is always thread_id 1 in forum groups
  topics.general = 1;

  for (const def of CABINET_TOPIC_DEFS) {
    if (def.key === "general") continue;
    if (topics[def.key] && topics[def.key]! > 0) continue;
    try {
      const created = await api.createForumTopic(chatId, def.name);
      topics[def.key] = created.message_thread_id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Topic may already exist under another id — try to find by name
      console.warn(`[telegram-topics] create ${def.key}:`, msg);
    }
  }

  // Best-effort: list topics isn't in older Bot API; keep what we have.
  const state: TelegramTopicsState = {
    chatId: String(chatId),
    isForum: true,
    topics,
    updatedAt: new Date().toISOString(),
  };
  await saveTopicsState(dataDir, state);
  return state;
}

/** Send into a cabinet forum topic (falls back to main chat if topics off). */
export async function sendInTopic(
  api: Api | Bot["api"],
  chatId: string | number,
  dataDir: string,
  key: CabinetTopicKey,
  text: string,
  extra?: {
    readonly parse_mode?: "Markdown";
    readonly reply_markup?: unknown;
  },
): Promise<void> {
  const state = await loadTopicsState(dataDir);
  const threadId = threadIdForKey(state, key);
  const body = text.slice(0, 3500);
  try {
    await api.sendMessage(chatId, body, {
      parse_mode: extra?.parse_mode,
      reply_markup: extra?.reply_markup as never,
      ...(threadId != null ? { message_thread_id: threadId } : {}),
    });
  } catch {
    await api.sendMessage(chatId, body, {
      reply_markup: extra?.reply_markup as never,
      ...(threadId != null ? { message_thread_id: threadId } : {}),
    });
  }
}

export function formatTopicsBrief(state: TelegramTopicsState): string {
  if (!state.isForum) {
    return [
      "🧵 *Cabinet threads*",
      "",
      "This chat is not a Telegram *Forum* yet.",
      "1. Group settings → Topics → On",
      "2. Then run `/topics setup`",
      "",
      "Until then, replies stay in one stream (reply-chains).",
    ].join("\n");
  }
  const lines = CABINET_TOPIC_DEFS.map((d) => {
    const id = state.topics[d.key];
    return id
      ? `• ${d.name} — thread \`${id}\``
      : `• ${d.name} — _missing_ (re-run /topics setup)`;
  });
  return [
    "🧵 *Cabinet threads* (forum topics)",
    "",
    "• Seat topic → that minister only",
    "• *Cabinet Council* → all advisors debate + joint plan (same as @all)",
    "• Approvals → queue overview",
    "",
    ...lines,
  ].join("\n");
}
