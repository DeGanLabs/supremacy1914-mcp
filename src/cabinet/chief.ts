import type { NvidiaClient } from "./nvidia-client.js";
import type { CabinetMemory } from "./memory.js";
import type { SeatRegistry } from "./seats.js";
import type { ScopeToolGateway } from "../sensor/gateway.js";
import { MinisterAgent } from "./minister.js";
import { COST_CAPS } from "./cost-caps.js";
import type {
  CabinetPlan,
  MinisterOutput,
  PlanTask,
  SeatDefinition,
} from "./types.js";
import { createPlanId, hashPlanPayload } from "./ids.js";
import { classifyTasks } from "./policy.js";
import { normalizePlanTasks } from "./plan-normalize.js";
import { filterTrustedBorderMoves } from "./plan-filter.js";
import { unwrapWarPicture } from "./war-picture-util.js";
import { expandSafeRetreatMoves } from "./safe-route.js";
import {
  formatWarSituationAnswer,
  standingOrdersBlock,
} from "./war-brief.js";
import { filterGoalsForPicture, type GameSession } from "./session.js";
import { getEventBus } from "./events.js";
import { formatGroupsBrief, loadGroups } from "./groups.js";
import { formatGeneralsBrief, loadGenerals } from "./generals.js";
import {
  formatIntelBrief,
  loadIntelEvents,
} from "./intel-events.js";
import {
  formatFinanceBrief,
  loadFinanceState,
} from "./finance-model.js";
import { formatMarketDigest } from "./market-engine.js";
import {
  detectOutputLanguageOverride,
  type CabinetLanguage,
} from "./language.js";
import { guessDiploTarget, sanitizeNewsCopy } from "./news-opsec.js";

function wantsForeignDraft(text: string): boolean {
  return /(?:\bdm\b|\bdraft(?:\s+(?:a|the))?\s+message\b|\btext\s+\w|\bmsg\s+\w|\bmessage\s+to\b|\btell\s+(?:him|her|them)\b|\bwrite\s+(?:him|her|them)\b|\bpay for airport\b)/i.test(
    text,
  );
}

/** Status / sitrep — answer from snapshot, no move orders. */
function isSituationAsk(text: string): boolean {
  const t = text.toLowerCase();
  // Never fast-path planning / ops / campaigns
  if (
    /\b(move|attack|invade|push|retreat|bombard|approve|build|construct|spy plan|draft |dm |plan|tasks?|campaign|offensive|strategy|how we (get|take|attack|retake)|full plan|war against)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return /\b(situat(ion)?|status|sitrep|how (are|is) we|what('s| is) (our|the) (situat|status|position)|assess(ment)?|overview|standing orders|actual situat)\b/i.test(
    t,
  );
}

export interface CabinetTurnResult {
  readonly publicLines: string[];
  readonly plan: CabinetPlan | null;
  readonly bridgeDown: boolean;
  readonly note?: string;
  /** Speeches already delivered live via onSeatSpeech. */
  readonly streamed?: boolean;
}

export type SeatSpeechHook = (
  seat: SeatDefinition,
  out: MinisterOutput,
  meta: { reaction: boolean },
) => void | Promise<void>;

export type SeatTypingHook = (seat: SeatDefinition) => void | Promise<void>;

/** Speak order: eco/intel ground truth before ops seats that depend on it. */
const SEAT_PRIORITY: Record<string, number> = {
  finance: 0,
  intel: 1,
  foreign: 2,
  war: 3,
  defense: 4,
};

function orderSeats(seats: SeatDefinition[]): SeatDefinition[] {
  return [...seats].sort(
    (a, b) =>
      (SEAT_PRIORITY[a.id] ?? 50) - (SEAT_PRIORITY[b.id] ?? 50) ||
      a.id.localeCompare(b.id),
  );
}

function formatPeerBriefings(
  outputs: { seat: SeatDefinition; out: MinisterOutput }[],
): string {
  if (!outputs.length) return "";
  return outputs
    .map((o) => {
      const speech = o.out.public_line.trim() || "(silent)";
      const facts = o.out.facts.slice(0, 4).join("; ");
      const concerns = o.out.concerns.slice(0, 3).join("; ");
      const draft = o.out.draft_message?.trim()
        ? `\n  (has draft ready — ${o.out.draft_message.trim().slice(0, 120)}…)`
        : "";
      const extras = [
        facts ? `facts: ${facts}` : "",
        concerns ? `concerns: ${concerns}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `@${o.seat.name}: "${speech}"${extras ? `\n  ${extras}` : ""}${draft}`;
    })
    .join("\n\n");
}

export class CabinetChief {
  /** Per-seat locks — Finance can run while War is still thinking. */
  private readonly busySeats = new Set<string>();
  private readonly minister: MinisterAgent;
  private readonly gateway: ScopeToolGateway;

  constructor(
    private readonly nvidia: NvidiaClient,
    private readonly memory: CabinetMemory,
    private readonly seats: SeatRegistry,
    gateway: ScopeToolGateway,
    private readonly session?: GameSession,
  ) {
    this.gateway = gateway;
    this.minister = new MinisterAgent(nvidia, gateway, seats);
  }

  /** True if any seat is mid-turn (legacy / war-watch). */
  isBusy(): boolean {
    return this.busySeats.size > 0;
  }

  isSeatBusy(seatId: string): boolean {
    return this.busySeats.has(seatId);
  }

  busySeatIds(): string[] {
    return [...this.busySeats];
  }

  /** War watch should skip only when ops seats are mid-turn (bridge contention). */
  isBusyForWarWatch(): boolean {
    return (
      this.busySeats.has("war") ||
      this.busySeats.has("defense") ||
      this.busySeats.has("war-watch")
    );
  }

  async handleUserMessage(
    text: string,
    opts: {
      readonly continueConversation?: boolean;
      /** Sticky /advisor 1:1 — ignore other seats unless @mentioned. */
      readonly forceSeatIds?: readonly string[];
      /** Do not auto-pull need_from peers (stay 1:1). */
      readonly singleAdvisor?: boolean;
      /** Live “X is typing” before each seat. */
      readonly onSeatTyping?: SeatTypingHook;
      /** Deliver each seat as they finish (streamed cabinet). */
      readonly onSeatSpeech?: SeatSpeechHook;
    } = {},
  ): Promise<CabinetTurnResult> {
    await this.session?.scrubStaleGoals();
    const goalsBlock = await this.buildGoalsBlock();
    const routed = this.seats.resolveMentions(text);

    const convEarly = await this.memory.loadConversationState();
    const cabinetLanguage: CabinetLanguage =
      convEarly?.cabinetLanguage ?? "en";
    const outputLanguage = detectOutputLanguageOverride(text);

    if (routed.cabinetOnly) {
      const brief = await this.nvidia.chat({
        tier: "fast",
        system: await this.seats.loadChiefPrompt({ cabinetLanguage }),
        user: `Goals:\n${goalsBlock}\n\nSummarize status for the player in 5 short lines based on goals only (no invented game stats):\n${text}`,
      });
      return { publicLines: [brief], plan: null, bridgeDown: false };
    }

    let seats: SeatDefinition[] = [];
    if (opts.forceSeatIds?.length && !routed.seats.length && !routed.all) {
      seats = opts.forceSeatIds
        .map((id) => this.seats.get(id))
        .filter((s): s is SeatDefinition => !!s);
    } else {
      seats = routed.seats;
    }
    if (
      !seats.length &&
      !routed.all &&
      !routed.cabinetOnly &&
      opts.continueConversation !== false
    ) {
      const conv = await this.memory.loadConversationState();
      const sticky = conv?.activeAdvisor;
      if (sticky) {
        const s = this.seats.get(sticky);
        if (s) seats = [s];
      } else if (conv?.seatIds?.length) {
        seats = conv.seatIds
          .map((id) => this.seats.get(id))
          .filter((s): s is SeatDefinition => !!s);
      }
    }
    if (!seats.length && !routed.all) {
      return {
        publicLines: [
          "No advisor selected — tap /advisor (or @War / @Finance / @Intel / @Foreign / @Defense). Sticky advisor remembers who you last chose.",
        ],
        plan: null,
        bridgeDown: false,
        note: "no_advisor",
      };
    }
    if (routed.all) seats = this.seats.list();
    // "DM him / draft message" always routes Foreign — War does not lecture instead.
    if (wantsForeignDraft(text)) {
      const foreign = this.seats.get("foreign");
      if (foreign && !seats.some((s) => s.id === "foreign")) {
        seats = [...seats, foreign];
      }
      // Prefer Foreign as primary when the ask is purely a draft.
      if (
        foreign &&
        seats.length === 2 &&
        seats.some((s) => s.id === "war") &&
        /dm |draft |text\s|msg\s|message\s+to/i.test(text) &&
        !/move|attack|invade|bombard/i.test(text)
      ) {
        seats = [foreign];
      }
      // Pure draft with sticky War → Foreign only
      if (
        foreign &&
        seats.length === 1 &&
        seats[0]!.id !== "foreign" &&
        /^(text|msg|dm)\b/i.test(text.trim()) &&
        !/move|attack|invade|bombard/i.test(text)
      ) {
        seats = [foreign];
      }
    }
    seats = orderSeats(seats);
    const councilMode = routed.all;

    // Instant sitrep — no NVIDIA. Uses last war-picture.json (watch keeps it fresh).
    if (
      seats.length === 1 &&
      (seats[0]!.id === "war" ||
        seats[0]!.id === "defense" ||
        seats[0]!.id === "intel") &&
      isSituationAsk(text)
    ) {
      const snap = (await this.memory.loadWarPicture()) as Parameters<
        typeof formatWarSituationAnswer
      >[0];
      const line = formatWarSituationAnswer(snap, text);
      if (line) {
        const seat = seats[0]!;
        await this.memory.appendSeatNote(seat.id, line);
        await this.memory.appendTranscript({
          role: "seat",
          seatId: seat.id,
          text: line,
        });
        const conv = await this.memory.loadConversationState();
        await this.memory.saveConversationState({
          ...(conv ?? { seatIds: [], updatedAt: new Date().toISOString() }),
          seatIds: [seat.id],
          activeAdvisor: seat.id,
          lastPlanId: conv?.lastPlanId,
          autoPilot: conv?.autoPilot,
          humanMode: conv?.humanMode,
          cabinetLanguage: conv?.cabinetLanguage,
          lastDraft: conv?.lastDraft,
          transcript: conv?.transcript,
          updatedAt: new Date().toISOString(),
        });
        return {
          publicLines: [`@${seat.name}: ${line}`],
          plan: null,
          bridgeDown: false,
        };
      }
    }

    const locked: string[] = [];
    for (const s of seats) {
      this.busySeats.add(s.id);
      locked.push(s.id);
    }

    try {
      // Fast path by default. Quality only for @all or CABINET_QUALITY=1.
      const useQuality =
        process.env.CABINET_QUALITY === "1" || routed.all;
      const warBriefBase = await this.memory.loadWarBrief();
      const fieldAware = await this.memory.loadFieldAwarenessBrief();
      const warBrief = fieldAware
        ? `${warBriefBase}\n\n${fieldAware}`
        : warBriefBase;
      const goals = await this.memory.getGoals();
      const standingWarOrders = standingOrdersBlock(goals);
      const dataDir =
        process.env.CABINET_DATA_DIR?.trim() || "data/cabinet";
      void getEventBus(dataDir)
        .publish("PLAYER_ORDER", {
          source: "chief",
          payload: { text: text.slice(0, 400) },
        })
        .catch(() => undefined);

      let groupsBrief = "";
      let generalsBrief = "";
      let intelBrief = "";
      let financeBrief = "";
      try {
        const groups = await loadGroups(dataDir);
        groupsBrief = formatGroupsBrief(groups);
        const generals = await loadGenerals(dataDir);
        generalsBrief = formatGeneralsBrief(generals);
        intelBrief = formatIntelBrief(await loadIntelEvents(dataDir));
        const fin = await loadFinanceState(dataDir);
        if (fin) {
          financeBrief = `${formatFinanceBrief(fin)}\n${formatMarketDigest(fin)}`;
        }
        try {
          const { FinanceMemory } = await import("../finance/memory.js");
          const { formatFinanceBrief: fmtPic } = await import(
            "../finance/format.js"
          );
          const fm = new FinanceMemory(dataDir);
          const pic = await fm.loadFinancePicture();
          if (pic) {
            financeBrief = [financeBrief, fmtPic(pic)].filter(Boolean).join("\n\n");
          }
        } catch {
          /* optional FCC picture */
        }
      } catch {
        /* optional */
      }

      let sharedWarPicture: string | undefined;
      const needsWarPic = seats.some(
        (s) => s.id === "war" || s.id === "defense" || s.id === "intel",
      );
      if (needsWarPic && this.gateway.isBridgeHealthy()) {
        try {
          const { fetchAndScoreOnce } = await import("./war-loop.js");
          const { formatWarBriefing } = await import("./war-brief.js");
          const snap = await fetchAndScoreOnce(this.gateway, this.memory);
          sharedWarPicture = formatWarBriefing(
            snap,
            snap.picture,
            COST_CAPS.maxWarBriefChars,
          );
        } catch (err) {
          console.warn(
            "war picture prefetch failed:",
            err instanceof Error ? err.message : String(err),
          );
          sharedWarPicture = warBrief;
        }
      }

      const bySeat = new Map<
        string,
        { seat: SeatDefinition; out: MinisterOutput }
      >();

      const recentActions =
        (await this.memory.loadRecentActionsBrief()) || undefined;

      const runSeat = async (
        seat: SeatDefinition,
        reactionPass: boolean,
      ): Promise<"ok" | "bridge_down"> => {
        const peers = [...bySeat.values()].filter((p) => p.seat.id !== seat.id);
        try {
          if (!reactionPass && opts.onSeatTyping) {
            await opts.onSeatTyping(seat);
          }
          const recentConversation = await this.memory.loadTranscriptBlock();
          const seatNotes = (
            await this.memory.loadSeatNotes(seat.id, COST_CAPS.maxSeatNotesInject)
          ).join("\n");
          const out = await this.minister.run({
            seat,
            question: text,
            goalsBlock,
            useQualityModel: useQuality,
            peerBriefings: formatPeerBriefings(peers),
            reactionPass,
            warBrief:
              seat.id === "war" ||
              seat.id === "defense" ||
              seat.id === "intel"
                ? warBrief
                : undefined,
            standingWarOrders:
              seat.id === "war" || seat.id === "defense"
                ? standingWarOrders
                : undefined,
            sharedWarPicture:
              seat.id === "war" ||
              seat.id === "defense" ||
              seat.id === "intel"
                ? sharedWarPicture
                : undefined,
            skipWarPictureFetch: true,
            recentConversation: recentConversation || undefined,
            seatNotes: seatNotes || undefined,
            recentActions,
            groupsBrief:
              seat.id === "war" || seat.id === "defense"
                ? groupsBrief
                : undefined,
            generalsBrief:
              seat.id === "war" || seat.id === "defense"
                ? generalsBrief
                : undefined,
            intelBrief:
              seat.id === "war" ||
              seat.id === "defense" ||
              seat.id === "intel"
                ? intelBrief
                : undefined,
            financeBrief:
              seat.id === "finance" || seat.id === "war"
                ? financeBrief
                : undefined,
            cabinetLanguage,
            outputLanguage,
            councilMode,
          });
          bySeat.set(seat.id, { seat, out });
          await this.memory.appendSeatNote(
            seat.id,
            out.public_line || JSON.stringify(out.concerns),
          );
          await this.memory.appendTranscript({
            role: "seat",
            seatId: seat.id,
            text: out.public_line || "",
          });
          if (out.draft_message?.trim()) {
            await this.memory.appendTranscript({
              role: "seat",
              seatId: seat.id,
              text: `[draft] ${out.draft_message.trim().slice(0, 400)}`,
            });
          }
          // Stream first-pass only (reaction updates peers/plan, avoids double posts).
          if (opts.onSeatSpeech && !reactionPass) {
            await opts.onSeatSpeech(seat, out, { reaction: false });
          }
          for (const c of out.concerns.slice(0, 2)) {
            await this.memory.addHypothesis({
              id: `h_${Date.now()}_${seat.id}`,
              text: c,
              fromSeat: seat.id,
              createdAt: new Date().toISOString(),
            });
          }
          return "ok";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/game not connected/i.test(msg)) return "bridge_down";
          bySeat.set(seat.id, {
            seat,
            out: {
              facts: [],
              concerns: [msg],
              proposals: [],
              need_from: [],
              draft_message: null,
              public_line: `error — ${msg}`,
            },
          });
          return "ok";
        }
      };

      for (const seat of seats) {
        const r = await runSeat(seat, false);
        if (r === "bridge_down") {
          return {
            publicLines: [
              '🔴 game not connected — run `npm run cabinet` + `npm run cabinet:serve`, open the game tab, then: fetch("http://127.0.0.1:9878/browser-console.js").then(r=>r.text()).then(eval) and s1914.connectCabinetBridge("ws://127.0.0.1:8765", TOKEN). Or `npm run cabinet:keep`. Then /status.',
            ],
            plan: null,
            bridgeDown: true,
          };
        }
      }

      // 1:1 advisor / single @mention: do not auto-pull other seats.
      const singleLane =
        !!opts.singleAdvisor ||
        (!!opts.forceSeatIds && opts.forceSeatIds.length === 1) ||
        routed.seats.length === 1;

      if (!singleLane) {
        const needSeatIds = new Set<string>();
        for (const o of bySeat.values()) {
          for (const n of o.out.need_from) {
            needSeatIds.add(n.toLowerCase().replace(/^@/, ""));
          }
        }
        const extraSeats = orderSeats(
          [...needSeatIds]
            .map((id) => this.seats.get(id))
            .filter((s): s is SeatDefinition => !!s && !bySeat.has(s.id)),
        );
        for (const seat of extraSeats) {
          this.busySeats.add(seat.id);
          locked.push(seat.id);
          const r = await runSeat(seat, false);
          if (r === "bridge_down") {
            return {
              publicLines: [
                '🔴 game not connected — run `npm run cabinet` + `npm run cabinet:serve`, open the game tab, then connectCabinetBridge. Or `npm run cabinet:keep`. Then /status.',
              ],
              plan: null,
              bridgeDown: true,
            };
          }
        }

        const needs = [...bySeat.values()].flatMap((o) => o.out.need_from);
        // Council always debates; otherwise reaction only when someone tagged need_from.
        const wantReaction =
          bySeat.size > 1 &&
          COST_CAPS.maxDebateRounds > 1 &&
          (councilMode || needs.length > 0);

        if (wantReaction) {
          for (const seat of orderSeats(
            [...bySeat.values()].map((v) => v.seat),
          )) {
            const r = await runSeat(seat, true);
            if (r === "bridge_down") {
              return {
                publicLines: [
                  '🔴 game not connected — run `npm run cabinet` + `npm run cabinet:serve`, open the game tab, then connectCabinetBridge. Or `npm run cabinet:keep`. Then /status.',
                ],
                plan: null,
                bridgeDown: true,
              };
            }
          }
        }
      }

      const outputs = orderSeats([...bySeat.values()].map((v) => v.seat)).map(
        (s) => bySeat.get(s.id)!,
      );
      const streamed = !!opts.onSeatSpeech;
      const publicLines: string[] = [];
      let lastDraftSaved: import("./memory.js").LastDiploDraft | null | undefined;
      for (const o of outputs) {
        if (!streamed && o.out.public_line.trim()) {
          publicLines.push(`@${o.seat.name}: ${o.out.public_line}`);
        }
        const draft = o.out.draft_message?.trim();
        if (draft) {
          if (!streamed) {
            publicLines.push(
              `@${o.seat.name} draft (copy-paste):\n${draft}`,
            );
          }
          const nationGuess = guessDiploTarget({
            question: text,
            publicLine: o.out.public_line,
            draft,
          });
          lastDraftSaved = {
            text: draft,
            targetNation: nationGuess ?? undefined,
            language: outputLanguage ?? cabinetLanguage,
            seatId: o.seat.id,
            savedAt: new Date().toISOString(),
          };
        }
      }

      // Skip second NVIDIA call when nobody proposed moves (Q&A / advice only).
      const wantsOrders =
        outputs.some((o) => o.out.proposals.length > 0) ||
        /\b(move|attack|invade|push|retreat|bombard|approve|build|concentrate|pull)\b/i.test(
          text,
        );
      const plan = wantsOrders
        ? await this.mergePlan(text, outputs, goalsBlock, cabinetLanguage)
        : null;
      if (plan) await this.memory.savePlan(plan);
      const conv = await this.memory.loadConversationState();
      const stickySeat =
        outputs.length === 1
          ? outputs[0]!.seat.id
          : (opts.forceSeatIds?.length === 1
              ? opts.forceSeatIds[0]
              : null);
      await this.memory.saveConversationState({
        ...(conv ?? { seatIds: [], updatedAt: new Date().toISOString() }),
        seatIds: outputs.map((o) => o.seat.id),
        activeAdvisor: stickySeat ?? conv?.activeAdvisor ?? null,
        lastPlanId: plan?.id ?? conv?.lastPlanId,
        autoPilot: conv?.autoPilot,
        humanMode: conv?.humanMode,
        cabinetLanguage: conv?.cabinetLanguage ?? cabinetLanguage,
        lastDraft:
          lastDraftSaved !== undefined
            ? lastDraftSaved
            : (conv?.lastDraft ?? null),
        transcript: conv?.transcript,
        updatedAt: new Date().toISOString(),
      });
      return {
        publicLines,
        plan,
        bridgeDown: false,
        streamed: !!opts.onSeatSpeech,
        note: opts.onSeatSpeech ? "streamed" : undefined,
      };
    } finally {
      for (const id of locked) this.busySeats.delete(id);
    }
  }

  private async mergePlan(
    question: string,
    outputs: { seat: SeatDefinition; out: MinisterOutput }[],
    goalsBlock: string,
    cabinetLanguage: CabinetLanguage = "en",
  ): Promise<CabinetPlan | null> {
    if (!outputs.length) return null;
    const ministerProposals = outputs.flatMap((o) => o.out.proposals);
    // No executable proposals → skip chief NVIDIA merge (was ~half the latency).
    if (!ministerProposals.length) return null;

    const bundle = outputs.map((o) => ({
      seat: o.seat.id,
      ...o.out,
    }));
    const chiefRaw = await this.nvidia.chat({
      tier: process.env.CABINET_QUALITY === "1" ? "quality" : "fast",
      system: await this.seats.loadChiefPrompt({ cabinetLanguage }),
      user: `Goals:\n${goalsBlock}\n\nPlayer asked:\n${question}\n\nMinister JSON bundle:\n${JSON.stringify(bundle).slice(0, 8000)}\n\nRules:\n- Executable ONLY: moveArmy, constructBuilding, attackArmy, delayArmy, writeNews with real args.\n- Same destination = multiple moveArmy (group move). Do NOT spam delayArmy to "wait together".\n- Never duplicate the same move/build. At most ONE writeNews. Never empty proposeOnly {}.\n- writeNews is PUBLIC — no attack hours, army ids, stack sizes, hero names, or column axes.\n- Spy/Q&A/draft chat → tasks: [] (advice lives in public_line / draft_message).\n- moveArmy rationale must name destination province. Coords from war picture only.\nReturn JSON: {"goalSummary":"","assumptions":[],"tasks":[],"facts":[],"concerns":[]}`,
      json: true,
    });

    let merged: {
      goalSummary?: string;
      assumptions?: string[];
      tasks?: PlanTask[];
      facts?: string[];
      concerns?: string[];
    };
    try {
      merged = JSON.parse(chiefRaw) as typeof merged;
    } catch {
      merged = {};
    }

    const picture = unwrapWarPicture(await this.memory.loadWarPicture());
    const goals = await this.memory.getGoals();
    const chiefTasks = merged.tasks ?? [];
    // Prefer chief list when present to avoid double-counting minister copies.
    const rawTasks = chiefTasks.length
      ? [...chiefTasks, ...ministerProposals]
      : ministerProposals;
    const goalSummary = merged.goalSummary || question.slice(0, 120);
    const normalized = filterTrustedBorderMoves(
      expandSafeRetreatMoves(
        normalizePlanTasks(rawTasks, picture, goalSummary),
        picture,
      ),
      picture,
      goals,
    );
    const classified = classifyTasks(normalized);

    for (const f of merged.facts ?? []) await this.memory.appendFact(f);

    // PLAN only when something can actually run on approve.
    if (!classified.executable.length) return null;

    // OPSEC + single article: scrub writeNews bodies before the president sees Approve.
    const tasks = classified.executable.map((t) => {
      if (t.type !== "writeNews") return t;
      const scrubbed = sanitizeNewsCopy({
        title: String(t.args.title ?? ""),
        body: String(t.args.body ?? ""),
      });
      return {
        ...t,
        args: {
          ...t.args,
          title: scrubbed.title,
          body: scrubbed.body,
        },
        rationale: scrubbed.scrubbed
          ? `${t.rationale ?? "publish"} (opsec-scrubbed: ${scrubbed.reasons.join(", ")})`
          : t.rationale,
      };
    });

    return {
      id: createPlanId(),
      createdAt: new Date().toISOString(),
      goalSummary,
      assumptions: merged.assumptions ?? [],
      tasks,
      payloadHash: hashPlanPayload(tasks),
      status: "proposed",
      sourceSeatIds: outputs.map((o) => o.seat.id),
    };
  }

  private async buildGoalsBlock(): Promise<string> {
    const sessionLine =
      this.session?.sessionPromptBlock() ??
      "SESSION: bind bridge to lock gameId.";
    let goals = await this.memory.getGoals();
    const pic = await this.memory.loadWarPicture();
    if (pic && goals.length) {
      goals = filterGoalsForPicture(
        goals,
        pic as Parameters<typeof filterGoalsForPicture>[1],
      );
    }
    const goalsText = goals.length
      ? goals.map((g) => `- ${g.key}: ${g.value}`).join("\n")
      : "(no standing goals for this match)";
    return `${sessionLine}\n\nStanding goals:\n${goalsText}`;
  }
}
