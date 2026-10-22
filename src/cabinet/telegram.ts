import { Bot, InlineKeyboard, type Context } from "grammy";
import type { CabinetChief } from "./chief.js";
import type { CabinetMemory } from "./memory.js";
import type { CabinetExecutor } from "./executor.js";
import type { BrowserBridgeServer } from "../sensor/bridge-client.js";
import type { SeatRegistry } from "./seats.js";
import type { CabinetPlan } from "./types.js";
import { assertPlanHash, classifyTasks } from "./policy.js";
import type { NvidiaClient } from "./nvidia-client.js";
import { redactSecrets } from "./redact.js";
import { DEFAULT_SEAT_SCOPES, COST_CAPS } from "./cost-caps.js";
import type { SensorToolName } from "./cost-caps.js";
import { isSensorTool } from "../sensor/tools.js";
import { formatHumanPlan, planHasExecutable } from "./plan-format.js";
import {
  parseApproveSelection,
  selectExecutableTasks,
  type ApproveSelection,
} from "./approve-parse.js";
import {
  decorateMilitaryText,
  formatMinisterLine,
  formatStatusLines,
  formatWarRoomHome,
  seatIcon,
  seatLabel,
} from "./telegram-format.js";
import {
  CABINET_LANGUAGES,
  isCabinetLanguage,
  languageLabel,
  wantsSendLastDraft,
  type CabinetLanguage,
} from "./language.js";
import {
  displayNameForSeat,
  upsertSeatOverride,
} from "./seat-overrides.js";
import {
  ensureCabinetTopics,
  formatTopicsBrief,
  isCouncilThread,
  loadTopicsState,
  seatIdFromThreadId,
  sendInTopic,
  topicKeyForSeat,
  threadIdForKey,
  type CabinetTopicKey,
  type TelegramTopicsState,
} from "./telegram-topics.js";
import { normalizePlanTasks } from "./plan-normalize.js";
import { unwrapWarPicture } from "./war-picture-util.js";
import { formatThreadTranscript } from "./diplo-format.js";
import { addHeroTask, rankHeroes, loadHeroTasks } from "./hero-tasks.js";
import { expandSafeRetreatMoves } from "./safe-route.js";
import {
  applyConfirmedGoals,
  detectGoalOverrideIntent,
  formatProposedGoals,
} from "./player-orders.js";
import { mayAutoExecute, type HumanMode } from "./priority.js";
import { getCommandQueue } from "./command-queue.js";
import {
  formatGroupsBrief,
  loadGroups,
  saveGroups,
  seedDefaultGroups,
  attachArmyToGroup,
} from "./groups.js";
import {
  assignArmyToGeneral,
  formatGeneralsBrief,
  generalCallName,
  loadGenerals,
  renameGeneral,
  seedGeneralsFromPicture,
  setGeneralMission,
} from "./generals.js";
import { loadFinanceState, formatFinanceBrief } from "./finance-model.js";
import { formatMarketDigest } from "./market-engine.js";
import { getEventBus } from "./events.js";
import {
  formatArmyBoard,
  formatEconomyStrip,
  formatRelationsTable,
  formatSpyRoster,
  formatStatsStrip,
} from "./display-format.js";

function formatPlan(
  plan: CabinetPlan,
  quiet: boolean,
  picture?: import("./war-types.js").WarPictureRaw | null,
): string {
  return formatHumanPlan(plan, quiet, picture);
}

const BRIDGE_HELP =
  '🔴 game not connected — on the PC: `npm run cabinet` + `npm run cabinet:serve` (or `cabinet:keep`). In the game tab console: load browser-console.js from http://127.0.0.1:9878 then `s1914.connectCabinetBridge("ws://127.0.0.1:8765", TOKEN)`. Then /status.';

function lastAdvisorKeyboard(
  seats: SeatRegistry,
  lastId: string | null | undefined,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (lastId && seats.get(lastId)) {
    const s = seats.get(lastId)!;
    kb.text(`↩ Talk to ${seatLabel(s.id, s.name)}`, `advisor:${s.id}`).row();
  }
  kb.text("👥 Pick advisor", "home:advisor").text("🏠 Home", "home:show");
  return kb;
}

function approveTextFromCtx(ctx: Context): string {
  const cmdArg = ((ctx.match as string | undefined) || "").trim();
  if (cmdArg) return cmdArg;
  const replyText = ctx.message?.text?.trim();
  if (ctx.message?.reply_to_message && replyText) return replyText;
  return "approve";
}

function homeKeyboard(autoOn: boolean, mode?: string): InlineKeyboard {
  const modeLabel =
    mode === "PAUSE"
      ? "⏸ PAUSE"
      : mode === "ABORT"
        ? "🛑 STOP"
        : mode === "SUGGEST"
          ? "💡 SUGGEST"
          : autoOn
            ? "🟢 Auto ON"
            : "⚪ Auto OFF";
  return new InlineKeyboard()
    .text("🏛️ Cabinet", "home:show")
    .text("🧵 Threads", "home:topics")
    .row()
    .text("👥 Advisors", "home:advisor")
    .text("🗺 Games", "home:games")
    .row()
    .text("🌐 Language", "home:language")
    .text("⚔️ War board", "home:war")
    .row()
    .text("🤝 Diplomacy", "home:diplo")
    .text("🎖️ Heroes", "home:heroes")
    .row()
    .text("🪖 Groups", "home:groups")
    .text("📈 Market", "home:market")
    .row()
    .text(modeLabel, "home:auto")
    .text("📡 Status", "home:status")
    .row()
    .text("🛑 E-Stop", "home:estop");
}

function languageKeyboard(current?: CabinetLanguage | null): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const lang of CABINET_LANGUAGES) {
    const mark = current === lang.id ? "✓ " : "";
    kb.text(`${mark}${lang.label}`, `lang:${lang.id}`);
  }
  kb.row().text("🏠 Home", "home:show");
  return kb;
}

function draftActionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📨 Send in-game", "diplo:send")
    .text("✏️ Keep / revise", "diplo:revise")
    .row()
    .text("🏠 Home", "home:show");
}

function planKeyboard(planId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Approve all", `plan:approve:${planId}`)
    .text("❌ Reject", `plan:reject:${planId}`)
    .row()
    .text("1️⃣", `plan:pick:${planId}:1`)
    .text("2️⃣", `plan:pick:${planId}:2`)
    .text("3️⃣", `plan:pick:${planId}:3`)
    .text("4️⃣", `plan:pick:${planId}:4`)
    .row()
    .text("💬 Reply yes / do 1 and 2", `plan:approve:${planId}`);
}

/** Pending free-text for hero province assign (chatId → armyId+goal). */
const pendingHeroAssign = new Map<
  string,
  { armyId: number; goal: "invade" | "hold" | "withdraw"; heroName?: string }
>();

/** Pending advisor rename / personality edit. */
const pendingSeatEdit = new Map<
  string,
  { seatId: string; kind: "rename" | "personality" }
>();

/** Pending hero call-sign rename (chatId → armyId). */
const pendingHeroRename = new Map<string, { armyId: number }>();

/** Pending Confirm/Keep for player goal overrides. */
const pendingGoalOverride = new Map<
  string,
  { proposed: Array<{ key: string; value: string }>; summary: string }
>();

class RateLimiter {
  private timestamps: number[] = [];
  private warned = false;
  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
  ) {}
  tryTake(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxPerWindow) return false;
    this.timestamps.push(now);
    this.warned = false;
    return true;
  }
  shouldWarn(): boolean {
    if (this.warned) return false;
    this.warned = true;
    return true;
  }
}

export function startTelegramBot(input: {
  readonly token: string;
  readonly chatId: string;
  readonly ownerUserId: number;
  readonly quietApprove: boolean;
  readonly chief: CabinetChief;
  readonly memory: CabinetMemory;
  readonly executor: CabinetExecutor;
  readonly bridge: BrowserBridgeServer;
  readonly seats: SeatRegistry;
  readonly nvidia: NvidiaClient;
  /** Base cabinet dir (topics, bridge token). */
  readonly dataDir?: string;
  /** Match-scoped dir (goals, plans, queues). Defaults to dataDir. */
  readonly getDataDir?: () => string;
  readonly ownerOnlySensors?: boolean;
}): Bot {
  const bot = new Bot(input.token);
  const chatId = input.chatId;
  const baseDir =
    input.dataDir || process.env.CABINET_DATA_DIR?.trim() || "data/cabinet";
  const dataDir = () => input.getDataDir?.() ?? baseDir;
  const limiter = new RateLimiter(30, 60_000);
  let topicsState: TelegramTopicsState | null = null;

  const isOwner = (ctx: Context) => ctx.from?.id === input.ownerUserId;
  const inWarRoom = (ctx: Context) => String(ctx.chat?.id) === String(chatId);
  const ownerOnlySensors = input.ownerOnlySensors !== false;
  const autoExecLog: number[] = [];

  async function refreshTopics(): Promise<TelegramTopicsState> {
    topicsState = await loadTopicsState(baseDir);
    if (!topicsState) {
      topicsState = await ensureCabinetTopics(bot.api, chatId, baseDir);
    }
    return topicsState;
  }

  void refreshTopics().catch((err) =>
    console.warn(
      "[telegram-topics] boot load:",
      err instanceof Error ? err.message : String(err),
    ),
  );

  function ctxThreadId(ctx: Context): number | undefined {
    return (
      ctx.message?.message_thread_id ??
      ctx.callbackQuery?.message?.message_thread_id ??
      undefined
    );
  }

  /** Prefer posting a seat reply into that seat's forum topic. */
  async function replyForSeat(
    ctx: Context,
    seatId: string | null,
    text: string,
    extra?: { reply_markup?: InlineKeyboard; parse_mode?: "Markdown" },
  ): Promise<void> {
    const state = topicsState ?? (await refreshTopics());
    const current = ctxThreadId(ctx);
    // Council room stays together — never fan replies into seat topics.
    if (isCouncilThread(state, current)) {
      await safeReply(ctx, text, extra);
      return;
    }
    const key: CabinetTopicKey = seatId
      ? topicKeyForSeat(seatId)
      : "general";
    const preferred = threadIdForKey(state, key);
    if (
      state.isForum &&
      preferred != null &&
      current != null &&
      preferred !== current
    ) {
      await sendInTopic(bot.api, chatId, baseDir, key, text, extra);
      return;
    }
    await safeReply(ctx, text, extra);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function resolveDiploTarget(
    draft: {
      targetPlayerId?: number;
      targetNation?: string;
    },
  ): Promise<{ playerId?: number; name?: string; label: string } | null> {
    if (draft.targetPlayerId != null) {
      return {
        playerId: draft.targetPlayerId,
        label: String(draft.targetPlayerId),
      };
    }
    const nation = draft.targetNation?.trim();
    if (!nation) return null;
    // Soften "Ottoman empire" / typos for bridge findPlayer
    const cleaned = nation
      .replace(/\b(empire|kingdom|republic)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    try {
      const rel = (await input.bridge.call("get_relations", {})) as {
        players?: Array<{ id?: number; nation?: string; name?: string }>;
        rows?: Array<{ id?: number; nation?: string; name?: string }>;
      };
      const pool = [...(rel.players ?? []), ...(rel.rows ?? [])];
      const needle = cleaned.toLowerCase();
      const hit = pool.find((p) => {
        const n = (p.nation ?? "").toLowerCase();
        const nm = (p.name ?? "").toLowerCase();
        return (
          n === needle ||
          nm === needle ||
          n.includes(needle) ||
          needle.includes(n) ||
          nm.includes(needle)
        );
      });
      if (hit?.id != null) {
        return {
          playerId: Number(hit.id),
          label: hit.nation || hit.name || cleaned,
        };
      }
    } catch {
      /* fall through to name */
    }
    return { name: cleaned, label: cleaned };
  }

  async function sendLastDiploDraft(ctx: Context): Promise<boolean> {
    const conv = await input.memory.loadConversationState();
    const draft = conv?.lastDraft;
    if (!draft?.text?.trim()) {
      await safeReply(ctx, "No saved draft — ask Foreign to draft first.");
      return false;
    }
    if (!input.bridge.isHealthy()) {
      await safeReply(ctx, BRIDGE_HELP);
      return false;
    }
    const resolved = await resolveDiploTarget(draft);
    if (!resolved) {
      await safeReply(
        ctx,
        "Draft saved but no target nation/player — say e.g. `text Ottoman` again, then Send.",
      );
      return false;
    }
    try {
      await input.bridge.call("send_diplo", {
        ...(resolved.playerId != null
          ? { playerId: resolved.playerId }
          : { name: resolved.name }),
        text: draft.text,
      });
      await input.memory.appendTranscript({
        role: "system",
        text: `Sent diplo to ${resolved.label}: ${draft.text.slice(0, 200)}`,
      });
      await input.memory.appendRecentAction(
        "diplo_sent",
        `to ${resolved.label}: ${draft.text.slice(0, 120)}`,
      );
      if (resolved.playerId != null) {
        await input.memory.setLastDraft({
          ...draft,
          targetPlayerId: resolved.playerId,
          targetNation: resolved.label,
        });
      }
      await safeReply(
        ctx,
        `📨 Sent in-game to *${resolved.label}*.`,
        { parse_mode: "Markdown", reply_markup: await kbHome() },
      );
      return true;
    } catch (err) {
      await safeReply(
        ctx,
        `Send failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
      );
      return false;
    }
  }

  async function showAdvisorBoard(ctx: Context): Promise<void> {
    const conv = await input.memory.loadConversationState();
    const busy = new Set(input.chief.busySeatIds());
    const overrides = input.seats.getOverrides();
    const lines: string[] = [
      `👥 *Advisors*`,
      `Sticky: ${conv?.activeAdvisor ? seatLabel(conv.activeAdvisor, input.seats.get(conv.activeAdvisor)?.name ?? conv.activeAdvisor) : "none"}`,
      `Lang: ${languageLabel(conv?.cabinetLanguage ?? "en")}`,
      "",
    ];
    const kb = new InlineKeyboard();
    for (const s of input.seats.list()) {
      const notes = await input.memory.loadSeatNotes(s.id, 1);
      const last = notes[0]?.slice(0, 120) || "(no recent note)";
      const name = displayNameForSeat(s.id, s.name, overrides);
      lines.push(
        `${busy.has(s.id) ? "⏳" : "·"} ${seatLabel(s.id, name)} — ${last}`,
      );
      kb.text(`💬 ${name}`, `advisor:${s.id}`)
        .text("✏️", `seatedit:rename:${s.id}`)
        .text("🎭", `seatedit:personality:${s.id}`)
        .row();
    }
    kb.text("🔇 Clear", "advisor:clear").text("🏠 Home", "home:show");
    await safeReply(ctx, lines.join("\n"), {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  async function showLanguagePicker(ctx: Context): Promise<void> {
    const conv = await input.memory.loadConversationState();
    await safeReply(
      ctx,
      `🌐 *Cabinet language*\nAdvisors speak to you in this language.\nDrafts/articles can still be asked *in French* / *en tounsi* per message.\n\nCurrent: *${languageLabel(conv?.cabinetLanguage ?? "en")}*`,
      {
        parse_mode: "Markdown",
        reply_markup: languageKeyboard(conv?.cabinetLanguage ?? "en"),
      },
    );
  }

  async function showGamesPicker(ctx: Context): Promise<void> {
    if (!input.bridge.isHealthy()) {
      await safeReply(ctx, BRIDGE_HELP, { reply_markup: await kbHome() });
      return;
    }
    try {
      const raw = (await input.bridge.call("list_games", {})) as {
        games?: Array<{
          gameId: number;
          title?: string;
          day?: number | null;
          isCurrent?: boolean;
        }>;
        currentGameId?: number;
      };
      const games = raw.games ?? [];
      if (!games.length) {
        await safeReply(ctx, "No games on this account.", {
          reply_markup: await kbHome(),
        });
        return;
      }
      const lines = [
        `🗺 *Your games*`,
        `Pick one — the browser tab will switch; advisors bind to that match.`,
        "",
      ];
      const kb = new InlineKeyboard();
      for (const g of games.slice(0, 12)) {
        const mark = g.isCurrent ? "✓ " : "";
        const day = g.day != null ? ` D${g.day}` : "";
        lines.push(
          `${mark}*${g.title ?? g.gameId}* (\`${g.gameId}\`)${day}`,
        );
        kb.text(
          `${mark}${(g.title ?? String(g.gameId)).slice(0, 28)}${day}`,
          `game:pick:${g.gameId}`,
        ).row();
      }
      kb.text("🏠 Home", "home:show");
      await safeReply(ctx, lines.join("\n"), {
        parse_mode: "Markdown",
        reply_markup: kb,
      });
    } catch (err) {
      await safeReply(
        ctx,
        `list_games failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
        { reply_markup: await kbHome() },
      );
    }
  }

  async function requireOwner(ctx: Context): Promise<boolean> {
    if (isOwner(ctx)) return true;
    if (!ownerOnlySensors) return true;
    await safeReply(ctx, "🔒 owner only — sensors and cabinet commands are locked");
    return false;
  }

  function autoExecAllowed(): boolean {
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;
    while (autoExecLog.length && now - autoExecLog[0]! > windowMs) {
      autoExecLog.shift();
    }
    return autoExecLog.length < COST_CAPS.maxAutoExecutesPerHour;
  }

  function noteAutoExec(): void {
    autoExecLog.push(Date.now());
  }

  async function kbHome(): Promise<InlineKeyboard> {
    const conv = await input.memory.loadConversationState();
    return homeKeyboard(!!conv?.autoPilot, conv?.humanMode);
  }

  async function safeReply(
    ctx: Context,
    text: string,
    extra?: { reply_markup?: InlineKeyboard; parse_mode?: "Markdown" },
  ): Promise<void> {
    if (!limiter.tryTake()) {
      if (limiter.shouldWarn()) {
        await ctx.reply("⏳ rate limited — wait a minute", {
          message_thread_id: ctxThreadId(ctx),
        });
      }
      return;
    }
    const threadId = ctxThreadId(ctx);
    const base = {
      reply_markup: extra?.reply_markup,
      ...(threadId != null ? { message_thread_id: threadId } : {}),
    };
    try {
      await ctx.reply(text.slice(0, 3500), {
        ...base,
        parse_mode: extra?.parse_mode,
      });
    } catch {
      await ctx.reply(text.slice(0, 3500), base);
    }
  }

  async function showTopics(ctx: Context, setup: boolean): Promise<void> {
    if (setup) {
      await safeReply(ctx, "🧵 Setting up cabinet threads…");
      topicsState = await ensureCabinetTopics(bot.api, chatId, baseDir);
    } else {
      topicsState = (await loadTopicsState(baseDir)) ?? (await refreshTopics());
    }
    await safeReply(ctx, formatTopicsBrief(topicsState), {
      parse_mode: "Markdown",
      reply_markup: await kbHome(),
    });
  }

  bot.command("start", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    const conv = await input.memory.loadConversationState();
    const state = await refreshTopics();
    await safeReply(
      ctx,
      formatWarRoomHome({
        advisor: conv?.activeAdvisor,
        bridgeUp: input.bridge.isHealthy(),
        forumsOn: state.isForum,
      }),
      {
        parse_mode: "Markdown",
        reply_markup: await kbHome(),
      },
    );
  });

  bot.command("home", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    const conv = await input.memory.loadConversationState();
    const state = topicsState ?? (await refreshTopics());
    await safeReply(
      ctx,
      formatWarRoomHome({
        advisor: conv?.activeAdvisor,
        bridgeUp: input.bridge.isHealthy(),
        forumsOn: state.isForum,
      }),
      {
        parse_mode: "Markdown",
        reply_markup: await kbHome(),
      },
    );
  });

  bot.command("topics", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    const arg = ((ctx.match as string) || "").trim().toLowerCase();
    await showTopics(ctx, arg === "setup" || arg === "init" || arg === "create");
  });

  bot.command("auto", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!isOwner(ctx)) {
      await safeReply(ctx, "🔒 owner only");
      return;
    }
    const conv = await input.memory.loadConversationState();
    const next = !conv?.autoPilot;
    await input.memory.setAutoPilot(next);
    const q = getCommandQueue(dataDir());
    q.setPaused(false);
    q.setEmergencyStop(false);
    await safeReply(
      ctx,
      next
        ? "🟢 *Auto ON* — low-risk Phase-1 runs without Approve. High-impact still Confirm.\nStanding orders still apply until you Confirm new goals."
        : "⚪ *Auto OFF* — plans need your Approve again.",
      {
        parse_mode: "Markdown",
        reply_markup: await kbHome(),
      },
    );
  });

  bot.command("mode", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!isOwner(ctx)) {
      await safeReply(ctx, "🔒 owner only");
      return;
    }
    const arg = ((ctx.match as string) || "").trim().toUpperCase();
    const modes = ["AUTO", "SUGGEST", "CONFIRM", "PAUSE", "ABORT"] as const;
    if (!modes.includes(arg as (typeof modes)[number])) {
      const conv = await input.memory.loadConversationState();
      await safeReply(
        ctx,
        `Human mode: *${conv?.humanMode || (conv?.autoPilot ? "AUTO" : "CONFIRM")}*\nUsage: /mode AUTO|SUGGEST|CONFIRM|PAUSE|ABORT`,
        { parse_mode: "Markdown", reply_markup: await kbHome() },
      );
      return;
    }
    await input.memory.setHumanMode(arg as HumanMode);
    const q = getCommandQueue(dataDir());
    if (arg === "PAUSE") q.setPaused(true);
    else if (arg === "ABORT") {
      q.setEmergencyStop(true);
      q.setPaused(true);
    } else {
      q.setPaused(false);
      q.setEmergencyStop(false);
    }
    await safeReply(ctx, `Mode → *${arg}*`, {
      parse_mode: "Markdown",
      reply_markup: await kbHome(),
    });
  });

  bot.command("groups", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showGroups(ctx);
  });

  bot.command("market", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showMarket(ctx);
  });

  bot.command("diplo", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showDiplo(ctx);
  });

  bot.command("advisor", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showAdvisorBoard(ctx);
  });

  bot.command("language", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showLanguagePicker(ctx);
  });

  bot.command("games", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showGamesPicker(ctx);
  });

  bot.command("heroes", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showHeroes(ctx);
  });

  bot.command("spies", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showSpies(ctx);
  });

  bot.command("armies", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showArmies(ctx);
  });

  bot.command("stats", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showStats(ctx);
  });

  bot.command("eco", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    await showEco(ctx);
  });

  bot.command("status", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    const st = input.bridge.getStatus();
    const plans = await input.memory.getPlans();
    const open = plans.filter((p) => p.status === "proposed").length;
    const conv = await input.memory.loadConversationState();
    const topics = topicsState ?? (await refreshTopics());
    await safeReply(
      ctx,
      formatStatusLines({
        bridgeUp: input.bridge.isHealthy(),
        gameId: st.gameId,
        playerId: st.playerId,
        heartbeat: st.lastHeartbeatAt
          ? new Date(st.lastHeartbeatAt).toISOString()
          : null,
        model: input.nvidia.model,
        fast: input.nvidia.fastModel,
        openPlans: open,
        advisor: conv?.activeAdvisor ?? null,
        busySeats: input.chief.busySeatIds(),
        autoPilot: !!conv?.autoPilot,
        forumsOn: topics.isForum,
        language: languageLabel(conv?.cabinetLanguage ?? "en"),
      }),
      {
        parse_mode: "Markdown",
        reply_markup: await kbHome(),
      },
    );
  });

  bot.command("brief", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    void runCabinetTurn(ctx, "@cabinet status brief", { fireAndForget: true });
  });

  bot.command("war", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!(await requireOwner(ctx))) return;
    const rest = ((ctx.match as string | undefined) || "").trim().toLowerCase();
    const snap = await input.memory.loadWarPicture<{
      takenAt?: string;
      myNation?: string;
      day?: number;
      atWar?: { nation?: string; name?: string; id?: number }[];
      zones?: {
        level: string;
        nation: string;
        note: string;
        provinces?: string[];
        ownArmyIds?: number[];
        hostileArmyIds?: number[];
      }[];
      fronts?: unknown[];
      triggers?: { line: string }[];
      sensorDegraded?: boolean;
      gameId?: number;
      myPlayerId?: number;
    }>();
    if (!snap) {
      await safeReply(
        ctx,
        "📭 no war picture yet — wait for watch tick or reconnect bridge",
      );
      return;
    }
    if (rest === "board") {
      const { formatWarBoard } = await import("./war-loop.js");
      await safeReply(
        ctx,
        formatWarBoard(snap as import("./war-types.js").WarWatchSnapshot),
        { parse_mode: "Markdown" },
      );
      return;
    }
    const brief = await input.memory.loadWarBrief();
    await safeReply(ctx, decorateMilitaryText(brief.slice(0, 3500)));
  });

  bot.command("goal", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!isOwner(ctx)) {
      await safeReply(ctx, "🔒 owner only");
      return;
    }
    const rest = (ctx.match as string | undefined)?.trim() || "";
    const m = rest.match(/^set\s+(\S+)\s+(.+)$/i);
    if (!m) {
      const goals = await input.memory.getGoals();
      await safeReply(
        ctx,
        goals.length
          ? goals.map((g) => `🎯 ${g.key}=${g.value}`).join("\n")
          : "no goals — /goal set <key> <value>",
      );
      return;
    }
    await input.memory.setGoal(m[1]!, m[2]!);
    await safeReply(ctx, `✅ goal set: ${m[1]}=${m[2]}`);
  });

  bot.command("seat", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!isOwner(ctx)) {
      await safeReply(ctx, "🔒 owner only");
      return;
    }
    const rest = ((ctx.match as string | undefined) || "").trim();
    if (!rest || rest === "list") {
      await safeReply(
        ctx,
        input.seats
          .list()
          .map((s) => `${seatIcon(s.id)} ${s.id}: ${s.name}`)
          .join("\n"),
      );
      return;
    }
    const rem = rest.match(/^remove\s+(\S+)$/i);
    if (rem) {
      input.seats.remove(rem[1]!);
      await safeReply(ctx, `removed seat ${rem[1]}`);
      return;
    }
    const add = rest.match(
      /^add\s+(\S+)\s+"([^"]+)"(?:\s+scopes=([a-z0-9_,]+))?$/i,
    );
    if (add) {
      const id = add[1]!.toLowerCase();
      const name = add[2]!;
      const scopes = (add[3]?.split(",") || [
        "current_game",
        "get_own_armies",
      ]).filter((s): s is SensorToolName => isSensorTool(s));
      if (!scopes.length) {
        await safeReply(ctx, "no valid sensor scopes — use names from SENSOR_TOOLS");
        return;
      }
      const base = DEFAULT_SEAT_SCOPES.war;
      const dataScopes = scopes.length ? scopes : base;
      input.seats.add({
        id,
        name,
        role: name,
        mentionAliases: [`@${id[0]!.toUpperCase()}${id.slice(1)}`],
        dataScopes,
        systemPromptPath: "war.md",
      });
      await safeReply(ctx, `added seat ${id} scopes=${dataScopes.join(",")}`);
      return;
    }
    await safeReply(
      ctx,
      'usage: /seat list | /seat remove <id> | /seat add <id> "Name" scopes=tool,tool',
    );
  });

  async function doApprove(
    ctx: Context,
    selection?: ApproveSelection | null,
    planOverride?: CabinetPlan | null,
  ): Promise<void> {
    if (!isOwner(ctx)) {
      await safeReply(ctx, "🔒 owner only");
      return;
    }
    try {
      const plan = planOverride ?? (await resolvePlan(ctx, input.memory));
      if (!plan) {
        await safeReply(
          ctx,
          "📭 no plan found — reply to a PLAN or /approve <plan_id>",
        );
        return;
      }
      if (plan.status === "rejected") {
        await safeReply(ctx, "plan already rejected");
        return;
      }
      assertPlanHash(plan);

      const sel =
        selection ??
        parseApproveSelection(approveTextFromCtx(ctx)) ?? {
          approveAll: true,
          includeTasks: new Set<number>(),
          excludeTasks: new Set<number>(),
        };

      const chosen = selectExecutableTasks(plan.tasks, sel);
      const { executable, proposeOnly } = classifyTasks(plan.tasks);
      if (!executable.length) {
        await safeReply(
          ctx,
          proposeOnly.length
            ? "Advice only — nothing to run. Ask for moves/builds if you want an executable PLAN."
            : "approve refused — no executable Phase-1 tasks",
        );
        return;
      }
      if (!chosen.length) {
        await safeReply(
          ctx,
          "nothing selected — try Approve all, or tap 1️⃣ 2️⃣ on the PLAN",
        );
        return;
      }
      if (!input.bridge.isHealthy()) {
        await safeReply(ctx, BRIDGE_HELP);
        return;
      }
      // Re-resolve coords from live war picture so lat/long invents never ship.
      const picture = unwrapWarPicture(await input.memory.loadWarPicture());
      const fixedChosen = expandSafeRetreatMoves(
        normalizePlanTasks(chosen, picture, plan.goalSummary),
        picture,
      ).filter((t) => !t.proposeOnly);
      if (!fixedChosen.length) {
        await safeReply(
          ctx,
          "approve refused — move coords are off-map (e.g. lat/long) and could not resolve a province from the plan text. Ask @War for a new PLAN naming Whitehorse / Prince George.",
        );
        return;
      }
      plan.status = "approved";
      await input.memory.savePlan(plan);
      const result = await input.executor.executeApproved(plan, fixedChosen);
      const q = getCommandQueue(dataDir());
      await q.load();
      for (const r of result.results) {
        if (r.type === "moveArmy" && r.ok) {
          await q.logVerified({
            priority: 20,
            commander: "telegram-approve",
            action: "moveArmy",
            risk: "medium",
            detail: r.detail,
          });
        }
      }
      const skipped =
        executable.length - chosen.length + result.skippedProposeOnly;
      const okN = result.results.filter((r) => r.ok).length;
      const moving = result.results
        .filter((r) => r.ok)
        .map((r) => r.detail)
        .filter(Boolean)
        .slice(0, 4);
      const failed = result.results
        .filter((r) => !r.ok)
        .map((r) => `• ${r.type}: ${r.detail}`)
        .slice(0, 4);
      const summary =
        okN === 0
          ? `❌ *No soldiers moved*\nPlan \`${plan.id}\` did not queue on the map.\n${failed.join("\n") || "Bridge returned no verified orders."}`
          : input.quietApprove
            ? `🫡 *Moving on the map* — ${okN}/${fixedChosen.length} verified${skipped ? ` · ${skipped} skipped` : ""}${moving.length ? `\n${moving.map((d) => `• ${d}`).join("\n")}` : ""}`
            : `✅ approved ${plan.id} (${okN}/${fixedChosen.length} verified)\n${result.results.map((r) => `${r.ok ? "✅" : "❌"} ${r.type}: ${r.detail}`).join("\n")}`;
      await safeReply(ctx, decorateMilitaryText(summary), {
        parse_mode: "Markdown",
      });
      if (!result.ok) {
        await safeReply(
          ctx,
          "⚠️ Not all orders landed on the map — plan is retryable. Open the game and check paths, or ask @War for a new PLAN with real province names.",
        );
      }
    } catch (err) {
      await safeReply(
        ctx,
        redactSecrets(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function showGroups(ctx: Context): Promise<void> {
    const picture = unwrapWarPicture(await input.memory.loadWarPicture());
    const existing = await loadGroups(dataDir());
    const groups = seedDefaultGroups(picture, existing);
    await saveGroups(dataDir(), groups);
    await seedGeneralsFromPicture(dataDir(), picture);
    const generals = await loadGenerals(dataDir());
    const kb = new InlineKeyboard()
      .text("Refresh", "home:groups")
      .text("🏠 Home", "home:show");
    await safeReply(
      ctx,
      `🪖 *Force groups*\n\n${formatGroupsBrief(groups)}\n\n*Generals*\n${formatGeneralsBrief(generals)}`,
      { parse_mode: "Markdown", reply_markup: kb },
    );
  }

  async function showMarket(ctx: Context): Promise<void> {
    let state = await loadFinanceState(dataDir());
    if (!state && input.bridge.isHealthy()) {
      try {
        const resources = await input.bridge.call("get_resources", {});
        const market = await input.bridge.call("get_market", {});
        const { refreshFinanceFromTools } = await import("./finance-model.js");
        state = await refreshFinanceFromTools(dataDir(), resources, market);
      } catch (err) {
        await safeReply(
          ctx,
          redactSecrets(err instanceof Error ? err.message : String(err)),
        );
        return;
      }
    }
    if (!state) {
      await safeReply(ctx, "📈 No finance model yet — ask @Finance or connect bridge.", {
        reply_markup: await kbHome(),
      });
      return;
    }
    await safeReply(
      ctx,
      `📈 *Market*\n\n${formatMarketDigest(state)}\n\n${formatFinanceBrief(state)}`.slice(
        0,
        3500,
      ),
      { parse_mode: "Markdown", reply_markup: await kbHome() },
    );
  }

  async function showSpies(ctx: Context): Promise<void> {
    if (!input.bridge.isHealthy()) {
      await safeReply(ctx, BRIDGE_HELP);
      return;
    }
    try {
      const spies = await input.bridge.call("get_spies", {});
      await safeReply(ctx, decorateMilitaryText(formatSpyRoster(spies)), {
        reply_markup: await kbHome(),
      });
    } catch (err) {
      await safeReply(
        ctx,
        redactSecrets(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function showArmies(ctx: Context): Promise<void> {
    const picture = unwrapWarPicture(await input.memory.loadWarPicture());
    await safeReply(
      ctx,
      decorateMilitaryText(formatArmyBoard(picture, picture?.timeScale)),
      { reply_markup: await kbHome() },
    );
  }

  async function showStats(ctx: Context): Promise<void> {
    if (!input.bridge.isHealthy()) {
      await safeReply(ctx, BRIDGE_HELP);
      return;
    }
    try {
      const stats = await input.bridge.call("get_stats", {});
      await safeReply(ctx, formatStatsStrip(stats), {
        reply_markup: await kbHome(),
      });
    } catch (err) {
      await safeReply(
        ctx,
        redactSecrets(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function showEco(ctx: Context): Promise<void> {
    if (!input.bridge.isHealthy()) {
      await safeReply(ctx, BRIDGE_HELP);
      return;
    }
    try {
      const eco = await input.bridge.call("get_resources", {});
      await safeReply(ctx, formatEconomyStrip(eco), {
        reply_markup: await kbHome(),
      });
    } catch (err) {
      await safeReply(
        ctx,
        redactSecrets(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function showHeroes(ctx: Context): Promise<void> {
    if (!input.bridge.isHealthy()) {
      await safeReply(ctx, BRIDGE_HELP);
      return;
    }
    try {
      const heroes = (await input.bridge.call("get_heroes", {})) as {
        deployedOnMap?: Array<{
          armyId: number;
          province?: string | null;
          heroes?: Array<{
            name?: string;
            shortName?: string;
            level?: number;
            rarity?: string;
          }>;
        }>;
      };
      const picture = unwrapWarPicture(await input.memory.loadWarPicture());
      await seedGeneralsFromPicture(dataDir(), picture);
      const generals = await loadGenerals(dataDir());
      const enriched = (heroes.deployedOnMap ?? []).map((d) => {
        const army = picture?.ownArmies?.find((a) => a.id === d.armyId);
        return {
          ...d,
          units: army?.units ? [...army.units] : undefined,
          morale: army?.morale,
        };
      });
      const ranked = rankHeroes(enriched);
      if (!ranked.length) {
        await safeReply(ctx, "🎖️ No heroes deployed on the map.", {
          reply_markup: await kbHome(),
        });
        return;
      }
      const lines = ranked.slice(0, 12).map((h, i) => {
        const gen = generals.find((g) => g.heroArmyId === h.armyId);
        const call = gen ? generalCallName(gen) : h.heroName;
        const status = gen ? `[${gen.status}] ${gen.role}` : "unassigned";
        const stack = gen?.assignedArmyIds?.length
          ? ` · with ${gen.assignedArmyIds.slice(0, 4).join(",")}`
          : "";
        return `${i + 1}. *${call}* L${h.level} — ${h.stackSize} @ ${h.province} mor ${Math.round(h.morale)}\n   ${status}${gen?.mission ? ` · ${gen.mission}` : ""}${stack}`;
      });
      const kb = new InlineKeyboard();
      for (let i = 0; i < Math.min(ranked.length, 8); i++) {
        const h = ranked[i]!;
        const gen = generals.find((g) => g.heroArmyId === h.armyId);
        const label = gen ? generalCallName(gen) : h.heroName;
        kb.text(`${label.slice(0, 16)}`, `hero:view:${h.armyId}`);
        if (i % 2 === 1) kb.row();
      }
      kb.row().text("🏠 Home", "home:show");
      await safeReply(
        ctx,
        `🎖️ *Ops center* (generals)\n\n${lines.join("\n")}`,
        { parse_mode: "Markdown", reply_markup: kb },
      );
    } catch (err) {
      await safeReply(
        ctx,
        redactSecrets(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function showDiplo(ctx: Context): Promise<void> {
    if (!input.bridge.isHealthy()) {
      await safeReply(ctx, BRIDGE_HELP);
      return;
    }
    try {
      const msgs = (await input.bridge.call("get_messages", {})) as {
        threads?: Array<{
          otherPlayerId: number;
          other?: { nation?: string; name?: string };
          count?: number;
          last?: { bodyText?: string };
        }>;
      };
      let relBlock = "";
      try {
        const diplo = await input.bridge.call("get_relations", {});
        relBlock = `${formatRelationsTable(diplo)}\n\n`;
      } catch {
        relBlock = "";
      }
      const threads = (msgs.threads ?? []).slice(0, 8);
      if (!threads.length) {
        await safeReply(
          ctx,
          relBlock ? `${relBlock}🤝 No diplomacy threads.` : "🤝 No diplomacy threads.",
        );
        return;
      }
      const kb = new InlineKeyboard();
      const lines: string[] = [];
      for (let i = 0; i < threads.length; i++) {
        const t = threads[i]!;
        const label =
          t.other?.nation || t.other?.name || `p${t.otherPlayerId}`;
        lines.push(
          `${i + 1}. ${label} (${t.count ?? "?"} msgs) — ${(t.last?.bodyText ?? "").slice(0, 60)}`,
        );
        kb.text(label.slice(0, 28), `diplo:thread:${t.otherPlayerId}`);
        if (i % 2 === 1) kb.row();
      }
      kb.row().text("🏠 Home", "home:show");
      await input.memory.setActiveAdvisor("foreign");
      await safeReply(
        ctx,
        `${relBlock}🤝 *Diplomacy threads*\n\n${lines.join("\n")}\n\nTap a thread for the full chat.`,
        { parse_mode: "Markdown", reply_markup: kb },
      );
    } catch (err) {
      await safeReply(
        ctx,
        redactSecrets(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  bot.command("approve", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    await doApprove(ctx);
  });

  bot.command("reject", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    if (!isOwner(ctx)) {
      await safeReply(ctx, "🔒 owner only");
      return;
    }
    const plan = await resolvePlan(ctx, input.memory);
    if (!plan) {
      await safeReply(ctx, "📭 no plan found");
      return;
    }
    plan.status = "rejected";
    await input.memory.savePlan(plan);
    await safeReply(ctx, `❌ rejected ${plan.id} — bridge not touched`);
  });

  bot.on("callback_query:data", async (ctx) => {
    if (!inWarRoom(ctx)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const data = ctx.callbackQuery.data;
    if (
      ownerOnlySensors &&
      !isOwner(ctx) &&
      data !== "home:show"
    ) {
      await ctx.answerCallbackQuery({ text: "owner only" });
      return;
    }
    if (data.startsWith("advisor:")) {
      const id = data.slice("advisor:".length);
      if (id === "clear") {
        await input.memory.setActiveAdvisor(null);
        await ctx.answerCallbackQuery({ text: "Advisor cleared" });
        await safeReply(
          ctx,
          "🔇 Advisor cleared. Use /advisor to pick someone.",
          {
            reply_markup: await kbHome(),
          },
        );
        return;
      }
      const seat = input.seats.get(id);
      if (!seat) {
        await ctx.answerCallbackQuery({ text: "Unknown seat" });
        return;
      }
      await input.memory.setActiveAdvisor(seat.id);
      await ctx.answerCallbackQuery({ text: `Talking to ${seat.name}` });
      await safeReply(
        ctx,
        [
          `${seatIcon(seat.id)} *Now talking to ${seat.name}*`,
          "",
          "Type freely — no @tag needed.",
          "Switch anytime with /advisor or Home.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: await kbHome(),
        },
      );
      return;
    }

    if (data.startsWith("lang:")) {
      const id = data.slice("lang:".length);
      if (!isCabinetLanguage(id)) {
        await ctx.answerCallbackQuery({ text: "Unknown language" });
        return;
      }
      await input.memory.setCabinetLanguage(id);
      await ctx.answerCallbackQuery({ text: languageLabel(id) });
      await safeReply(
        ctx,
        `🌐 Advisors will speak to you in *${languageLabel(id)}*.\nSay e.g. \`draft in french\` any time for a one-off.`,
        { parse_mode: "Markdown", reply_markup: await kbHome() },
      );
      return;
    }

    if (data.startsWith("game:pick:")) {
      const gameId = Number(data.slice("game:pick:".length));
      await ctx.answerCallbackQuery({ text: "Switching…" });
      if (!input.bridge.isHealthy()) {
        await safeReply(ctx, BRIDGE_HELP);
        return;
      }
      try {
        const result = (await input.bridge.call("use_game", { gameId })) as {
          ok?: boolean;
          already?: boolean;
          switchingTo?: number;
          title?: string;
          note?: string;
        };
        if (result?.already) {
          await safeReply(
            ctx,
            `Already on *${result.title ?? gameId}*. Advisors use this match.`,
            { parse_mode: "Markdown", reply_markup: await kbHome() },
          );
          return;
        }
        await safeReply(
          ctx,
          `🗺 Switching browser to *${result?.title ?? gameId}*…\nWait for the map to load — bridge will rebind. Then /status.`,
          { parse_mode: "Markdown", reply_markup: await kbHome() },
        );
      } catch (err) {
        await safeReply(
          ctx,
          `use_game failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
        );
      }
      return;
    }

    if (data.startsWith("seatedit:")) {
      const parts = data.split(":");
      const kind = parts[1];
      const seatId = parts[2];
      if (
        (kind !== "rename" && kind !== "personality") ||
        !seatId ||
        !input.seats.get(seatId)
      ) {
        await ctx.answerCallbackQuery({ text: "Unknown" });
        return;
      }
      pendingSeatEdit.set(String(ctx.chat?.id), {
        seatId,
        kind,
      });
      await ctx.answerCallbackQuery();
      await safeReply(
        ctx,
        kind === "rename"
          ? `✏️ Reply with the new *display name* for ${seatId}:`
          : `🎭 Reply with the *personality* text for ${seatId} (how they should talk):`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (data === "diplo:send") {
      await ctx.answerCallbackQuery({ text: "Sending…" });
      await sendLastDiploDraft(ctx);
      return;
    }
    if (data === "diplo:revise") {
      await ctx.answerCallbackQuery({ text: "OK" });
      await input.memory.setActiveAdvisor("foreign");
      await safeReply(
        ctx,
        "Tell Foreign how to revise (e.g. shorter, warmer, in French).",
        { reply_markup: await kbHome() },
      );
      return;
    }

    if (data.startsWith("home:")) {
      const action = data.slice("home:".length);
      const conv = await input.memory.loadConversationState();
      if (action === "show") {
        await ctx.answerCallbackQuery({ text: "Cabinet" });
        const state = topicsState ?? (await refreshTopics());
        await safeReply(
          ctx,
          formatWarRoomHome({
            advisor: conv?.activeAdvisor,
            bridgeUp: input.bridge.isHealthy(),
            forumsOn: state.isForum,
          }),
          {
            parse_mode: "Markdown",
            reply_markup: await kbHome(),
          },
        );
        return;
      }
      if (action === "topics") {
        await ctx.answerCallbackQuery({ text: "Threads" });
        await showTopics(ctx, false);
        return;
      }
      if (action === "advisor") {
        await ctx.answerCallbackQuery();
        await showAdvisorBoard(ctx);
        return;
      }
      if (action === "language") {
        await ctx.answerCallbackQuery({ text: "Language" });
        await showLanguagePicker(ctx);
        return;
      }
      if (action === "games") {
        await ctx.answerCallbackQuery({ text: "Games" });
        await showGamesPicker(ctx);
        return;
      }
      if (action === "diplo") {
        await ctx.answerCallbackQuery({ text: "Diplomacy" });
        await showDiplo(ctx);
        return;
      }
      if (action === "heroes") {
        await ctx.answerCallbackQuery({ text: "Heroes" });
        await showHeroes(ctx);
        return;
      }
      if (action === "groups") {
        await ctx.answerCallbackQuery({ text: "Groups" });
        await showGroups(ctx);
        return;
      }
      if (action === "market") {
        await ctx.answerCallbackQuery({ text: "Market" });
        await showMarket(ctx);
        return;
      }
      if (action === "estop") {
        if (!isOwner(ctx)) {
          await ctx.answerCallbackQuery({ text: "owner only" });
          return;
        }
        await input.memory.setHumanMode("ABORT");
        const q = getCommandQueue(dataDir());
        q.setEmergencyStop(true);
        q.setPaused(true);
        await ctx.answerCallbackQuery({ text: "EMERGENCY STOP" });
        await safeReply(
          ctx,
          "🛑 *EMERGENCY STOP* — queue cancelled; no browser actions until /mode CONFIRM or /auto.",
          { parse_mode: "Markdown", reply_markup: await kbHome() },
        );
        return;
      }
      if (action === "auto") {
        if (!isOwner(ctx)) {
          await ctx.answerCallbackQuery({ text: "owner only" });
          return;
        }
        const next = !conv?.autoPilot;
        await input.memory.setAutoPilot(next);
        const q = getCommandQueue(dataDir());
        q.setPaused(false);
        q.setEmergencyStop(false);
        await ctx.answerCallbackQuery({
          text: next ? "Auto ON" : "Auto OFF",
        });
        await safeReply(
          ctx,
          next
            ? "🟢 *Auto ON* — low-risk Phase-1 executes without Approve."
            : "⚪ *Auto OFF* — plans need your Approve again.",
          {
            parse_mode: "Markdown",
            reply_markup: await kbHome(),
          },
        );
        return;
      }
      if (action === "war") {
        await ctx.answerCallbackQuery();
        await input.memory.setActiveAdvisor("war");
        if (!input.chief.busySeatIds().includes("war")) {
          void runCabinetTurn(ctx, "@War quick sitrep", {
            fireAndForget: true,
          });
        } else {
          await safeReply(ctx, "⚔️ War is already working — sitrep folded.", {
            reply_markup: await kbHome(),
          });
        }
        return;
      }
      if (action === "status") {
        await ctx.answerCallbackQuery();
        const st = input.bridge.getStatus();
        const plans = await input.memory.getPlans();
        const open = plans.filter((p) => p.status === "proposed").length;
        const c2 = await input.memory.loadConversationState();
        const topics = topicsState ?? (await refreshTopics());
        await safeReply(
          ctx,
          formatStatusLines({
            bridgeUp: input.bridge.isHealthy(),
            gameId: st.gameId,
            playerId: st.playerId,
            heartbeat: st.lastHeartbeatAt
              ? new Date(st.lastHeartbeatAt).toISOString()
              : null,
            model: input.nvidia.model,
            fast: input.nvidia.fastModel,
            openPlans: open,
            advisor: c2?.activeAdvisor ?? null,
            busySeats: input.chief.busySeatIds(),
            autoPilot: !!c2?.autoPilot,
            forumsOn: topics.isForum,
            language: languageLabel(c2?.cabinetLanguage ?? "en"),
          }),
          {
            parse_mode: "Markdown",
            reply_markup: await kbHome(),
          },
        );
        return;
      }
      if (action === "brief") {
        await ctx.answerCallbackQuery();
        void runCabinetTurn(ctx, "@cabinet status brief", {
          fireAndForget: true,
        });
        return;
      }
    }

    if (data.startsWith("goal:") && isOwner(ctx)) {
      const gAction = data.slice("goal:".length);
      const pending = pendingGoalOverride.get(String(ctx.chat?.id));
      if (gAction === "keep") {
        pendingGoalOverride.delete(String(ctx.chat?.id));
        await ctx.answerCallbackQuery({ text: "Kept standing orders" });
        await safeReply(
          ctx,
          "Keeping hold/no-invade/focus as-is.",
          { reply_markup: await kbHome() },
        );
        return;
      }
      if (gAction === "confirm" && pending) {
        pendingGoalOverride.delete(String(ctx.chat?.id));
        const goals = await input.memory.getGoals();
        await input.memory.replaceGoals(
          applyConfirmedGoals(goals, pending.proposed),
        );
        await getEventBus(dataDir()).publish("PLAYER_ORDER", {
          source: "telegram",
          payload: { confirmed: pending.proposed },
        });
        await ctx.answerCallbackQuery({ text: "Orders updated" });
        await safeReply(
          ctx,
          `✅ New orders confirmed:\n${formatProposedGoals(pending.proposed)}\n\n⏳ Building the full cabinet plan…`,
          { reply_markup: await kbHome() },
        );
        // Confirm used to only write goals — never asked ministers. Re-run now.
        const orderBody =
          pending.summary?.trim() ||
          pending.proposed.map((p) => p.value).join("\n");
        void runCabinetTurn(
          ctx,
          `@War @Intel @Finance PRESIDENT ORDERS (confirmed):\n${orderBody}\n\nProduce a phased executable plan for THESE orders from the live war picture. moveArmy tasks with real army ids + destinations. Do not invent other theaters.`,
          { fireAndForget: true },
        );
        return;
      }
      await ctx.answerCallbackQuery({ text: "nothing pending" });
      return;
    }

    if (data.startsWith("diplo:thread:")) {
      const pid = Number(data.slice("diplo:thread:".length));
      await ctx.answerCallbackQuery({ text: "Loading thread…" });
      if (!input.bridge.isHealthy()) {
        await safeReply(ctx, BRIDGE_HELP);
        return;
      }
      try {
        const thread = await input.bridge.call("get_thread", { playerId: pid });
        await input.memory.setActiveAdvisor("foreign");
        await safeReply(
          ctx,
          decorateMilitaryText(formatThreadTranscript(thread)).slice(0, 3500),
          {
            reply_markup: new InlineKeyboard()
              .text("Ask @Foreign", "advisor:foreign")
              .text("🏠 Home", "home:show"),
          },
        );
      } catch (err) {
        await safeReply(
          ctx,
          redactSecrets(err instanceof Error ? err.message : String(err)),
        );
      }
      return;
    }

    if (data.startsWith("hero:") && isOwner(ctx)) {
      const parts = data.split(":");
      const action = parts[1];
      const armyId = Number(parts[2]);
      if (!Number.isFinite(armyId)) {
        await ctx.answerCallbackQuery({ text: "bad hero" });
        return;
      }
      if (action === "view") {
        await ctx.answerCallbackQuery();
        const tasks = await loadHeroTasks(input.memory);
        const active = tasks.filter(
          (t) =>
            t.heroArmyId === armyId &&
            (t.status === "queued" || t.status === "active"),
        );
        const generals = await loadGenerals(dataDir());
        const gen = generals.find((g) => g.heroArmyId === armyId);
        const q = getCommandQueue(dataDir());
        await q.load();
        const queued = q
          .list(20)
          .filter(
            (c) =>
              c.commander === gen?.id ||
              c.army === armyId ||
              (gen?.assignedArmyIds ?? []).includes(c.army ?? -1),
          )
          .slice(-5);
        const kb = new InlineKeyboard()
          .text("Invade…", `hero:task:${armyId}:invade`)
          .text("Hold", `hero:task:${armyId}:hold`)
          .row()
          .text("Withdraw…", `hero:task:${armyId}:withdraw`)
          .text("Air-bridge", `hero:mission:${armyId}:air-bridge`)
          .row()
          .text("Attach nearby", `hero:attach:${armyId}`)
          .text("✏️ Call-sign", `hero:rename:${armyId}`)
          .row()
          .text("🎖️ Heroes", "home:heroes")
          .text("🏠 Home", "home:show");
        const call = gen ? generalCallName(gen) : String(armyId);
        await safeReply(
          ctx,
          [
            `🎖️ *${call}* — army \`${armyId}\`${gen?.callSign ? ` (game: ${gen.name})` : ""}`,
            gen
              ? `Status: ${gen.status} · ${gen.role}${gen.mission ? `\nMission: ${gen.mission}` : ""}\nKeep with him: ${gen.assignedArmyIds.slice(0, 10).join(", ") || "none"}`
              : "Not seeded yet — open Groups after war-watch tick.",
            `Hero tasks: ${active.length ? active.map((t) => `${t.goal} ${t.province ?? ""}`).join(", ") : "none"}`,
            queued.length
              ? `Queue: ${queued.map((c) => `${c.action}#${c.status}`).join(", ")}`
              : "Queue: empty",
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: kb },
        );
        return;
      }
      if (action === "rename") {
        await ctx.answerCallbackQuery();
        pendingHeroRename.set(String(ctx.chat?.id), { armyId });
        await safeReply(
          ctx,
          `✏️ Reply with the *call-sign* advisors should use for this hero (e.g. Callahan):`,
          { parse_mode: "Markdown" },
        );
        return;
      }
      if (action === "mission") {
        const mission = parts.slice(3).join(":") || "hold";
        await ctx.answerCallbackQuery({ text: "Mission set" });
        await setGeneralMission(
          dataDir(),
          `gen_${armyId}`,
          mission,
          mission === "hold" ? "DEFENDING" : "MOVING",
        );
        await addHeroTask(input.memory, {
          heroArmyId: armyId,
          goal: mission.includes("invade") ? "invade" : "hold",
          note: mission,
        });
        await safeReply(
          ctx,
          `✅ Mission *${mission}* assigned to general ${armyId}.`,
          { parse_mode: "Markdown", reply_markup: await kbHome() },
        );
        return;
      }
      if (action === "task") {
        const goal = parts[3] as "invade" | "hold" | "withdraw";
        if (goal === "hold") {
          await ctx.answerCallbackQuery({ text: "Hold queued" });
          await addHeroTask(input.memory, {
            heroArmyId: armyId,
            goal: "hold",
            note: "hold position",
          });
          await safeReply(
            ctx,
            `✅ Hold task queued for hero army ${armyId}. Auto/War will work it task-by-task.`,
            {
              reply_markup: await kbHome(),
            },
          );
          return;
        }
        await ctx.answerCallbackQuery({ text: "Reply with province" });
        pendingHeroAssign.set(String(ctx.chat?.id), {
          armyId,
          goal,
        });
        await safeReply(
          ctx,
          `Type the target province for *${goal}* (e.g. Honolulu):`,
          { parse_mode: "Markdown" },
        );
        return;
      }
      if (action === "attach") {
        await ctx.answerCallbackQuery();
        const picture = unwrapWarPicture(await input.memory.loadWarPicture());
        const hero = picture?.ownArmies?.find((a) => a.id === armyId);
        if (!hero?.pos) {
          await safeReply(ctx, "Hero army not in war picture.");
          return;
        }
        const nearby = (picture?.ownArmies ?? [])
          .filter((a) => a.id !== armyId && a.pos)
          .map((a) => ({
            a,
            d: Math.hypot(a.pos!.x - hero.pos!.x, a.pos!.y - hero.pos!.y),
          }))
          .filter((x) => x.d < 400)
          .sort((x, y) => x.d - y.d)
          .slice(0, 8);
        const kb = new InlineKeyboard();
        for (const { a } of nearby) {
          kb.text(
            `${a.province ?? a.id} (${a.id})`.slice(0, 28),
            `hero:attachok:${armyId}:${a.id}`,
          ).row();
        }
        kb.text("🏠 Home", "home:show");
        await safeReply(
          ctx,
          nearby.length
            ? "Tap armies/ships to attach to this hero’s next task:"
            : "No nearby stacks found.",
          { reply_markup: kb },
        );
        return;
      }
      if (action === "attachok") {
        const attachId = Number(parts[3]);
        await ctx.answerCallbackQuery({ text: "Attached" });
        const tasks = await loadHeroTasks(input.memory);
        let task = [...tasks]
          .reverse()
          .find(
            (t) =>
              t.heroArmyId === armyId &&
              (t.status === "queued" || t.status === "active"),
          );
        if (!task) {
          task = await addHeroTask(input.memory, {
            heroArmyId: armyId,
            goal: "hold",
            attachedArmyIds: [attachId],
          });
        } else {
          const { updateHeroTask } = await import("./hero-tasks.js");
          await updateHeroTask(input.memory, task.id, {
            attachedArmyIds: [
              ...new Set([...task.attachedArmyIds, attachId]),
            ],
          });
        }
        await assignArmyToGeneral(dataDir(), `gen_${armyId}`, attachId);
        const generals = await loadGenerals(dataDir());
        const gen = generals.find((g) => g.heroArmyId === armyId);
        if (gen?.groupId) {
          await attachArmyToGroup(dataDir(), gen.groupId, attachId);
        } else {
          await attachArmyToGroup(dataDir(), "grp_alaska_screen", attachId);
        }
        await safeReply(
          ctx,
          `✅ Attached army ${attachId} to general ${armyId} (group + ops ownership).`,
        );
        return;
      }
    }

    if (data.startsWith("plan:") && isOwner(ctx)) {
      const parts = data.split(":");
      const action = parts[1];
      const planId = parts[2];
      if (!planId) {
        await ctx.answerCallbackQuery({ text: "bad plan" });
        return;
      }
      const plan = await input.memory.getPlan(planId);
      if (!plan) {
        await ctx.answerCallbackQuery({ text: "plan gone" });
        return;
      }
      if (action === "reject") {
        plan.status = "rejected";
        await input.memory.savePlan(plan);
        await ctx.answerCallbackQuery({ text: "Rejected" });
        await safeReply(ctx, `❌ rejected ${plan.id}`);
        return;
      }
      if (action === "approve") {
        await ctx.answerCallbackQuery({ text: "Approving…" });
        await doApprove(
          ctx,
          {
            approveAll: true,
            includeTasks: new Set(),
            excludeTasks: new Set(),
          },
          plan,
        );
        return;
      }
      if (action === "pick") {
        const n = Number(parts[3]);
        if (!Number.isFinite(n) || n < 1) {
          await ctx.answerCallbackQuery({ text: "bad task #" });
          return;
        }
        await ctx.answerCallbackQuery({ text: `Approving task ${n}…` });
        await doApprove(
          ctx,
          {
            approveAll: false,
            includeTasks: new Set([n]),
            excludeTasks: new Set(),
          },
          plan,
        );
        return;
      }
    }

    await ctx.answerCallbackQuery();
  });

  async function deliverTurn(
    ctx: Context,
    turn: Awaited<ReturnType<CabinetChief["handleUserMessage"]>>,
  ): Promise<void> {
    if (turn.bridgeDown) {
      await safeReply(ctx, turn.publicLines[0] || BRIDGE_HELP);
      return;
    }
    if (turn.note === "no_advisor") {
      const conv = await input.memory.loadConversationState();
      const last =
        conv?.activeAdvisor ||
        conv?.seatIds?.[0] ||
        null;
      await safeReply(
        ctx,
        turn.publicLines[0] ||
          "No advisor selected — choose who to talk to (@War, @Finance, …).",
        { reply_markup: lastAdvisorKeyboard(input.seats, last) },
      );
      return;
    }
    // Speeches already streamed live with typing labels.
    if (turn.streamed || turn.note === "streamed") {
      // fall through to plan only
    } else {
    // Internal notes (e.g. fast-sitrep) stay in logs — never echo to Telegram.
    const lines = turn.publicLines.slice(0, 8);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const draftMatch = line.match(
        /^@(.+?)\s+draft\s*\(copy-paste\):\s*\n([\s\S]*)$/i,
      );
      if (draftMatch) {
        const seat = input.seats
          .list()
          .find(
            (s) =>
              s.name === draftMatch[1] ||
              s.id === draftMatch[1]!.toLowerCase() ||
              draftMatch[1]!.toLowerCase().includes(s.id),
          );
        const body = draftMatch[2]!.trim();
        const header = seat
          ? `${seatIcon(seat.id)} *Draft* — paste or tap Send:\n\n${body}`
          : `Draft — paste or tap Send:\n\n${body}`;
        void ctx.replyWithChatAction("typing").catch(() => undefined);
        if (i > 0) await sleep(600);
        await replyForSeat(ctx, seat?.id ?? "foreign", header, {
          parse_mode: "Markdown",
          reply_markup: draftActionKeyboard(),
        });
        continue;
      }
      const m = line.match(/^@([^:]+):\s*([\s\S]*)$/);
      if (m) {
        const seat = input.seats
          .list()
          .find(
            (s) =>
              s.name === m[1] ||
              s.id === m[1]!.toLowerCase() ||
              m[1]!.toLowerCase().includes(s.id),
          );
        const formatted = seat
          ? formatMinisterLine(seat.id, seat.name, m[2]!)
          : decorateMilitaryText(line);
        void ctx.replyWithChatAction("typing").catch(() => undefined);
        if (i > 0) await sleep(700);
        await replyForSeat(ctx, seat?.id ?? null, formatted, {
          parse_mode: "Markdown",
        });
      } else {
        if (i > 0) await sleep(400);
        await safeReply(ctx, decorateMilitaryText(line));
      }
    }
    } // end !streamed
    if (turn.plan && turn.plan.tasks.length > 0 && planHasExecutable(turn.plan)) {
      const picture = unwrapWarPicture(await input.memory.loadWarPicture());
      const conv = await input.memory.loadConversationState();
      const mode = (conv?.humanMode as HumanMode) ||
        (conv?.autoPilot ? "AUTO" : "CONFIRM");
      const q = getCommandQueue(dataDir());
      if (mode === "PAUSE" || mode === "ABORT" || q.isEmergencyStopped()) {
        await safeReply(
          ctx,
          `⏸ Mode ${mode} — plan ${turn.plan.id} saved but not executed. /mode CONFIRM or /auto to resume.`,
          { reply_markup: await kbHome() },
        );
        return;
      }
      const canAuto =
        mode === "AUTO" &&
        isOwner(ctx) &&
        autoExecAllowed() &&
        mayAutoExecute({
          mode,
          action: turn.plan.tasks.map((t) => t.type).join(","),
          risk: turn.plan.tasks.some((t) =>
            /attack|declare|strategic|writeNews/i.test(
              t.type + (t.rationale ?? ""),
            ),
          )
            ? "high"
            : "low",
          emergencyStop: q.isEmergencyStopped(),
          paused: q.isPaused(),
        });
      if (canAuto) {
        noteAutoExec();
        turn.plan.status = "approved";
        await input.memory.savePlan(turn.plan);
        const fixed = expandSafeRetreatMoves(
          normalizePlanTasks(turn.plan.tasks, picture, turn.plan.goalSummary),
          picture,
        ).filter((t) => !t.proposeOnly);
        try {
          const result = await input.executor.executeApproved(turn.plan, fixed);
          for (const r of result.results) {
            if (r.ok) {
              await input.memory.appendRecentAction(
                r.type,
                r.detail?.slice(0, 200) || r.type,
              );
            }
            if (r.ok && r.type === "moveArmy") {
              await q.logVerified({
                priority: 25,
                commander: "auto",
                action: "moveArmy",
                risk: "low",
                detail: r.detail,
              });
            }
          }
          const summary = result.results
            .map((r) => `${r.ok ? "✅" : "❌"} ${r.type}: ${r.detail}`)
            .join("\n");
          await safeReply(
            ctx,
            decorateMilitaryText(
              `🟢 Auto-ran ${turn.plan.id}\n${summary}${result.ok ? "" : "\n⚠️ retryable if failed"}`,
            ),
            { reply_markup: await kbHome() },
          );
        } catch (err) {
          await safeReply(
            ctx,
            redactSecrets(err instanceof Error ? err.message : String(err)),
          );
        }
        return;
      }
      // Auto ON but high-impact → Confirm UI still (never silent Approve spam for routine)
      if (conv?.autoPilot && !canAuto) {
        await safeReply(
          ctx,
          "⚠️ High-impact plan — Confirm required even with Auto ON:",
        );
      }
      const body = decorateMilitaryText(
        formatPlan(turn.plan, input.quietApprove, picture),
      );
      const planThread = ctxThreadId(ctx);
      const msg = await ctx.reply(body.slice(0, 3500), {
        parse_mode: "Markdown",
        reply_markup: planKeyboard(turn.plan.id),
        ...(planThread != null ? { message_thread_id: planThread } : {}),
      });
      turn.plan.telegramMessageId = msg.message_id;
      await input.memory.savePlan(turn.plan);
      // Mirror a short pointer into Approvals topic when forums are on
      const state = topicsState ?? (await refreshTopics());
      if (state.isForum && threadIdForKey(state, "approvals") != null) {
        const seatHint =
          turn.plan.sourceSeatIds?.[0] ??
          seatIdFromThreadId(state, planThread) ??
          "cabinet";
        void sendInTopic(
          bot.api,
          chatId,
          baseDir,
          "approvals",
          `📜 New orders from *${seatHint}* — \`${turn.plan.id}\`\nOpen that seat topic to approve, or tap buttons on the plan message.`,
          { parse_mode: "Markdown" },
        ).catch(() => undefined);
      }
    } else if (turn.plan && !planHasExecutable(turn.plan)) {
      // Should not happen (merge returns null) — never attach Approve.
    } else if (
      !turn.streamed &&
      turn.note !== "streamed" &&
      !turn.publicLines.length
    ) {
      // Chat replies stream live (publicLines emptied on purpose) — never spam
      // "no plan this turn" after a normal advisor answer.
      await safeReply(ctx, "📭 no plan this turn");
    }
  }

  async function runCabinetTurn(
    ctx: Context,
    text: string,
    opts: { fireAndForget?: boolean } = {},
  ): Promise<void> {
    if (!(await requireOwner(ctx))) return;
    const conv = await input.memory.loadConversationState();
    const state = topicsState ?? (await refreshTopics());
    const threadId = ctxThreadId(ctx);
    const inCouncil = isCouncilThread(state, threadId);
    const preMentions = input.seats.resolveMentions(text);
    // Council = @all only when no specific @War/@Foreign etc. was named.
    const effectiveText =
      inCouncil &&
      !preMentions.seats.length &&
      !/(^|\s)@(all|council)\b/i.test(text)
        ? `@all ${text}`
        : text;
    const mentions = input.seats.resolveMentions(effectiveText);
    const threadSeat = seatIdFromThreadId(state, threadId);
    const councilFull = mentions.all || (inCouncil && !mentions.seats.length);
    if (mentions.seats.length === 1) {
      await input.memory.setActiveAdvisor(mentions.seats[0]!.id);
    } else if (threadSeat && !mentions.all && !councilFull) {
      await input.memory.setActiveAdvisor(threadSeat);
    }
    const sticky =
      councilFull
        ? null
        : mentions.seats.length === 1
          ? mentions.seats[0]!.id
          : (threadSeat ?? conv?.activeAdvisor ?? null);
    const forceSeatIds =
      !mentions.seats.length && !mentions.all && sticky
        ? [sticky]
        : mentions.seats.length === 1
          ? [mentions.seats[0]!.id]
          : undefined;
    const singleAdvisor =
      !councilFull &&
      ((forceSeatIds?.length === 1 && !mentions.seats.length) ||
        mentions.seats.length === 1);

    const work = async () => {
      const typingMsgs = new Map<
        string,
        { chatId: number; messageId: number }
      >();
      try {
        await input.memory.appendTranscript({ role: "user", text: effectiveText });
        void ctx.replyWithChatAction("typing").catch(() => undefined);
        const turn = await input.chief.handleUserMessage(effectiveText, {
          continueConversation: true,
          forceSeatIds,
          singleAdvisor,
          onSeatTyping: async (seat) => {
            void ctx.replyWithChatAction("typing").catch(() => undefined);
            try {
              const shortName =
                seat.name
                  .replace(/\s+Affairs$/i, "")
                  .replace(/\s+&.*$/, "")
                  .trim() || seat.name;
              const msg = await ctx.reply(
                `${seatIcon(seat.id)} *${shortName}* is typing…`,
                { parse_mode: "Markdown" },
              );
              typingMsgs.set(seat.id, {
                chatId: msg.chat.id,
                messageId: msg.message_id,
              });
            } catch {
              /* ignore */
            }
          },
          onSeatSpeech: async (seat, out) => {
            const pending = typingMsgs.get(seat.id);
            typingMsgs.delete(seat.id);
            const line = out.public_line?.trim();
            const draft = out.draft_message?.trim();
            if (line) {
              const formatted = formatMinisterLine(seat.id, seat.name, line);
              if (pending) {
                try {
                  await bot.api.editMessageText(
                    pending.chatId,
                    pending.messageId,
                    formatted,
                    { parse_mode: "Markdown" },
                  );
                } catch {
                  await replyForSeat(ctx, seat.id, formatted, {
                    parse_mode: "Markdown",
                  });
                }
              } else {
                await replyForSeat(ctx, seat.id, formatted, {
                  parse_mode: "Markdown",
                });
              }
            } else if (pending) {
              try {
                await bot.api.deleteMessage(
                  pending.chatId,
                  pending.messageId,
                );
              } catch {
                /* ignore */
              }
            }
            if (draft) {
              const header = `${seatIcon(seat.id)} *Draft* — paste or tap Send:\n\n${draft}`;
              await replyForSeat(ctx, seat.id, header, {
                parse_mode: "Markdown",
                reply_markup: draftActionKeyboard(),
              });
            }
            await sleep(350);
          },
        });
        await deliverTurn(ctx, turn);
      } catch (err) {
        for (const pending of typingMsgs.values()) {
          try {
            await bot.api.deleteMessage(pending.chatId, pending.messageId);
          } catch {
            /* ignore */
          }
        }
        typingMsgs.clear();
        await safeReply(
          ctx,
          redactSecrets(err instanceof Error ? err.message : String(err)),
        );
      }
    };

    if (opts.fireAndForget) {
      void work();
      return;
    }
    await work();
  }

  bot.on("message:text", async (ctx) => {
    if (!inWarRoom(ctx)) return;
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const seatEdit = pendingSeatEdit.get(String(ctx.chat?.id));
    if (seatEdit && isOwner(ctx)) {
      pendingSeatEdit.delete(String(ctx.chat?.id));
      const value = text.trim().slice(0, seatEdit.kind === "rename" ? 48 : 800);
      if (!value) {
        await safeReply(ctx, "Empty — cancelled.");
        return;
      }
      await upsertSeatOverride(baseDir, {
        id: seatEdit.seatId,
        ...(seatEdit.kind === "rename"
          ? { displayName: value }
          : { personality: value }),
      });
      await input.seats.refreshOverrides();
      await safeReply(
        ctx,
        seatEdit.kind === "rename"
          ? `✅ Renamed ${seatEdit.seatId} → *${value}*`
          : `✅ Personality updated for *${seatEdit.seatId}*`,
        { parse_mode: "Markdown", reply_markup: await kbHome() },
      );
      return;
    }

    const heroRename = pendingHeroRename.get(String(ctx.chat?.id));
    if (heroRename && isOwner(ctx)) {
      pendingHeroRename.delete(String(ctx.chat?.id));
      const callSign = text.trim().slice(0, 48);
      if (!callSign) {
        await safeReply(ctx, "Empty — cancelled.");
        return;
      }
      const g = await renameGeneral(
        dataDir(),
        `gen_${heroRename.armyId}`,
        callSign,
      );
      await safeReply(
        ctx,
        g
          ? `✅ Advisors will call him *${callSign}* (keeps armies ${g.assignedArmyIds.slice(0, 6).join(", ") || "none"}).`
          : `Could not rename — seed generals first (Home · Heroes).`,
        { parse_mode: "Markdown", reply_markup: await kbHome() },
      );
      return;
    }

    const pending = pendingHeroAssign.get(String(ctx.chat?.id));
    if (pending && isOwner(ctx)) {
      pendingHeroAssign.delete(String(ctx.chat?.id));
      const province = text.trim().slice(0, 60);
      await addHeroTask(input.memory, {
        heroArmyId: pending.armyId,
        heroName: pending.heroName,
        goal: pending.goal,
        province,
        note: `${pending.goal} ${province}`,
      });
      await setGeneralMission(
        dataDir(),
        `gen_${pending.armyId}`,
        `${pending.goal} ${province}`,
        pending.goal === "invade" ? "ATTACKING" : "MOVING",
      );
      await safeReply(
        ctx,
        `✅ Task queued: ${pending.goal} → ${province} (general ${pending.armyId}).`,
        {
          reply_markup: await kbHome(),
        },
      );
      return;
    }

    // Send last Foreign draft in-game (no re-draft).
    if (isOwner(ctx) && wantsSendLastDraft(text)) {
      await sendLastDiploDraft(ctx);
      return;
    }

    // Player order vs standing goals — Confirm new vs Keep hold/no-invade
    if (isOwner(ctx)) {
      const override = detectGoalOverrideIntent(text);
      if (override?.wantsOverride && !pendingGoalOverride.has(String(ctx.chat?.id))) {
        pendingGoalOverride.set(String(ctx.chat?.id), {
          proposed: override.proposed,
          summary: override.summary,
        });
        await safeReply(
          ctx,
          `📋 *New orders detected* (conflicts with standing hold/no-invade?)\n\n${formatProposedGoals(override.proposed)}\n\nConfirm to update goals, or Keep standing orders.`,
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard()
              .text("✅ Confirm new orders", "goal:confirm")
              .text("🛡 Keep hold/no-invade", "goal:keep"),
          },
        );
        // Continue to cabinet turn as well
      }
    }

    if (ctx.message.reply_to_message && isOwner(ctx)) {
      const low = text.trim().toLowerCase();
      if (low === "reject" || low === "no" || low === "cancel") {
        const plan = await resolvePlan(ctx, input.memory);
        if (plan) {
          plan.status = "rejected";
          await input.memory.savePlan(plan);
          await safeReply(ctx, `❌ rejected ${plan.id} — bridge not touched`);
        }
        return;
      }
      const sel = parseApproveSelection(text);
      if (sel) {
        await doApprove(ctx, sel);
        return;
      }
    }

    // President language: "yes" / "do it" / "approve" against latest proposed PLAN
    // (no need to reply-to the PLAN message when sticky context has one open).
    if (isOwner(ctx)) {
      const approveLikeEarly = parseApproveSelection(text);
      if (approveLikeEarly) {
        const mentionsEarly = input.seats.resolveMentions(text);
        const hasSeatAsk =
          mentionsEarly.all ||
          mentionsEarly.cabinetOnly ||
          mentionsEarly.seats.length > 0;
        if (!hasSeatAsk) {
          const open = await resolvePlan(ctx, input.memory);
          if (open && open.status === "proposed") {
            await doApprove(ctx, approveLikeEarly, open);
            return;
          }
        }
      }
    }

    const conv = await input.memory.loadConversationState();
    const state = topicsState ?? (await refreshTopics());
    const threadId = ctxThreadId(ctx);
    const inCouncil = isCouncilThread(state, threadId);
    const earlyMentions = input.seats.resolveMentions(text);
    const mentions = input.seats.resolveMentions(
      inCouncil &&
        !earlyMentions.seats.length &&
        !/(^|\s)@(all|council)\b/i.test(text)
        ? `@all ${text}`
        : text,
    );
    const threadSeat = seatIdFromThreadId(state, threadId);
    // Newspaper / diplo draft → Foreign (not sticky Finance/War)
    if (
      !inCouncil &&
      !mentions.seats.length &&
      !mentions.all &&
      /(?:\barticle\b|\bnewspaper\b|\bwrite news\b|\bpost as\b|\bpropaganda\b|\bpress release\b|\btext\s+\w|\bmsg\s+\w|\bdm\b|\bdraft\s+(?:a\s+|the\s+)?message\b|\bmessage\s+to\b)/i.test(
        text,
      )
    ) {
      await input.memory.setActiveAdvisor("foreign");
    }
    // Forum topic = that minister's room (no @ needed)
    if (threadSeat && !mentions.seats.length && !mentions.all && !inCouncil) {
      await input.memory.setActiveAdvisor(threadSeat);
    }
    const sticky = !!(
      !inCouncil &&
      (conv?.activeAdvisor || threadSeat)
    );
    const approveLike = parseApproveSelection(text);

    if (
      !inCouncil &&
      !mentions.all &&
      !mentions.cabinetOnly &&
      !mentions.seats.length &&
      !sticky &&
      !threadSeat &&
      !approveLike &&
      !/@cabinet|@all|@council|@finance|@war|@defense|@defence|@foreign|@intel/i.test(
        text,
      )
    ) {
      const last = conv?.activeAdvisor || conv?.seatIds?.[0] || null;
      await safeReply(
        ctx,
        state.isForum
          ? `Open *🗣️ Cabinet Council* for joint planning, a minister topic for 1:1, or pick below:`
          : last
            ? `No @seat in that message. Tap to continue with your last advisor, or /topics setup for threads:`
            : `Pick a minister, or enable *Topics* and run /topics setup:`,
        {
          parse_mode: "Markdown",
          reply_markup: lastAdvisorKeyboard(input.seats, last),
        },
      );
      return;
    }

    // No bot-status spam ("drafting orders…"). Just the Telegram typing bubble.
    void ctx.replyWithChatAction("typing").catch(() => undefined);

    void runCabinetTurn(ctx, text, { fireAndForget: true });
  });

  // Slash-command menu (Telegram “/” button) for discoverability.
  const menuCommands: { command: string; description: string }[] = [
    { command: "home", description: "Cabinet home — threads & actions" },
    { command: "topics", description: "Forum threads — /topics setup" },
    { command: "advisor", description: "Advisors board — talk / rename / personality" },
    { command: "language", description: "Cabinet language EN / FR / Tounsi" },
    { command: "games", description: "Pick account game for advisors" },
    { command: "heroes", description: "Ops center — generals & missions" },
    { command: "groups", description: "Force groups (Alaska / air-bridge / reserve)" },
    { command: "market", description: "Finance market digest" },
    { command: "diplo", description: "Diplomacy threads + relation matrix" },
    { command: "spies", description: "Spy roster and latest jobs" },
    { command: "armies", description: "Own army board with ETA" },
    { command: "stats", description: "Clock, rank, K/D, revolt" },
    { command: "eco", description: "Stockpile and hours-to-zero" },
    { command: "auto", description: "Toggle AI Auto mode ON/OFF" },
    { command: "mode", description: "AUTO|SUGGEST|CONFIRM|PAUSE|ABORT" },
    { command: "status", description: "Bridge, Auto, advisor status" },
    { command: "war", description: "War board / sitrep" },
    { command: "brief", description: "Quick cabinet brief" },
    { command: "approve", description: "Approve latest / replied PLAN" },
    { command: "reject", description: "Reject latest / replied PLAN" },
    { command: "start", description: "Open War Room home" },
  ];
  void bot.api
    .setMyCommands(menuCommands)
    .then(() =>
      bot.api.setMyCommands(menuCommands, {
        scope: { type: "chat", chat_id: Number(chatId) || chatId },
      }),
    )
    .then(() => console.log("telegram command menu registered"))
    .catch((err) =>
      console.warn(
        "telegram setMyCommands failed:",
        err instanceof Error ? err.message : String(err),
      ),
    );

  return bot;
}

async function resolvePlan(
  ctx: Context,
  memory: CabinetMemory,
): Promise<CabinetPlan | null> {
  const arg = ((ctx.match as string | undefined) || "").trim();
  if (arg) {
    return memory.getPlan(arg);
  }
  const reply = ctx.message?.reply_to_message?.text || "";
  const m = reply.match(/PLAN\s+(plan_[a-z0-9_]+)/i);
  if (m) return memory.getPlan(m[1]!);
  const plans = await memory.getPlans();
  return [...plans].reverse().find((p) => p.status === "proposed") ?? null;
}
