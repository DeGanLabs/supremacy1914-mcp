import { config } from "dotenv";
config({ override: true });

import { Bot } from "grammy";
import {
  ensureCabinetTopics,
  formatTopicsBrief,
} from "../src/cabinet/telegram-topics.ts";

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required");
  }
  const dataDir = process.env.CABINET_DATA_DIR || "data/cabinet";
  const bot = new Bot(token);
  const me = await bot.api.getMe();
  const member = await bot.api.getChatMember(chatId, me.id);
  console.log("bot", me.username, "status", member.status);
  if (member.status === "administrator") {
    const perms = member as {
      can_manage_topics?: boolean;
      can_promote_members?: boolean;
    };
    console.log("can_manage_topics", perms.can_manage_topics);
  } else {
    console.log(
      "NEED_ADMIN: promote @" +
        me.username +
        " to admin with Manage Topics, then re-run",
    );
  }

  const chat = await bot.api.getChat(chatId);
  console.log(
    "chat",
    chat.id,
    "is_forum=",
    (chat as { is_forum?: boolean }).is_forum,
  );

  const state = await ensureCabinetTopics(bot.api, chatId, dataDir);
  const brief = formatTopicsBrief(state);
  console.log(brief);
  console.log(JSON.stringify(state, null, 2));

  try {
    await bot.api.sendMessage(chatId, brief, { parse_mode: "Markdown" });
  } catch (err) {
    console.warn("sendMessage failed:", err instanceof Error ? err.message : err);
  }

  const missing = Object.entries({
    war: state.topics.war,
    defense: state.topics.defense,
    finance: state.topics.finance,
    intel: state.topics.intel,
    foreign: state.topics.foreign,
    approvals: state.topics.approvals,
  }).filter(([, id]) => !id);
  if (missing.length && member.status !== "administrator") {
    process.exitCode = 2;
  } else if (missing.length) {
    process.exitCode = 3;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
