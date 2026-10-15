import type { NvidiaClient } from "./nvidia-client.js";
import type { ScopeToolGateway } from "../sensor/gateway.js";
import type { SeatDefinition } from "./types.js";
import { MinisterOutputSchema, type MinisterOutput } from "./types.js";
import { COST_CAPS } from "./cost-caps.js";
import type { SensorToolName } from "./cost-caps.js";
import type { SeatRegistry } from "./seats.js";
import {
  formatWarBriefing,
  formatWarSituationAnswer,
  formatWarSituationFromBrief,
} from "./war-brief.js";
import { scoreWarPicture } from "./war-watch.js";
import type { WarPictureRaw } from "./war-types.js";
import { wrapUntrusted } from "./untrusted.js";
import { formatStatsStrip } from "./display-format.js";
import {
  formatThreadTranscript,
  resolvePlayerIdFromText,
} from "./diplo-format.js";

const TOOL_HINT = `You may request tools by including a JSON field "tool_request": {"name":"<tool>","args":{...}} instead of final answer.
After tool results are provided, return final MinisterOutput JSON:
{"facts":[],"concerns":[],"proposals":[],"need_from":[],"draft_message":null,"public_line":""}

If the player asks for situation / status / assessment (not orders), put the answer in public_line from the live war picture — never claim you lack data that is already preloaded. proposals may be [].`;

export class MinisterAgent {
  constructor(
    private readonly nvidia: NvidiaClient,
    private readonly gateway: ScopeToolGateway,
    private readonly seats: SeatRegistry,
  ) {}

  async run(input: {
    readonly seat: SeatDefinition;
    readonly question: string;
    readonly goalsBlock: string;
    readonly useQualityModel: boolean;
    /** Prior ministers this turn (ordered). React to these; do not re-ask for their data. */
    readonly peerBriefings?: string;
    readonly reactionPass?: boolean;
    readonly warBrief?: string;
    readonly standingWarOrders?: string;
    /** Compact war picture already fetched for this turn. */
    readonly sharedWarPicture?: string;
    /** Skip get_war_picture tool preload (use sharedWarPicture instead). */
    readonly skipWarPictureFetch?: boolean;
    /** Rolling Telegram/cabinet chat for continuity. */
    readonly recentConversation?: string;
    /** Recent seat notes for this minister. */
    readonly seatNotes?: string;
    readonly groupsBrief?: string;
    readonly generalsBrief?: string;
    readonly intelBrief?: string;
    readonly financeBrief?: string;
  }): Promise<MinisterOutput> {
    this.gateway.resetTurn(input.seat.id);
    if (!this.gateway.isBridgeHealthy()) {
      throw new Error("game not connected");
    }
    const system = `${await this.seats.loadPrompt(input.seat)}\n\n${TOOL_HINT}`;
    let user = `Standing goals:\n${input.goalsBlock}\n\nPlayer question:\n${input.question}\n\nRespond with JSON.`;
    if (input.recentConversation?.trim()) {
      user += `\n\n${wrapUntrusted("recent conversation", input.recentConversation)}`;
    }
    if (input.seatNotes?.trim()) {
      user += `\n\nYour recent notes:\n${input.seatNotes}`;
    }
    if (input.standingWarOrders?.trim()) {
      user += `\n\nStanding war orders (OBEY — filter every proposal):\n${input.standingWarOrders}`;
    }
    if (input.groupsBrief?.trim()) {
      user += `\n\nForce groups:\n${input.groupsBrief}`;
    }
    if (input.generalsBrief?.trim()) {
      user += `\n\nGenerals / ops:\n${input.generalsBrief}`;
    }
    if (input.intelBrief?.trim()) {
      user += `\n\n${input.intelBrief}`;
    }
    if (input.financeBrief?.trim()) {
      user += `\n\nFinance/market model (prefer over raw dumps):\n${input.financeBrief}`;
    }
    if (input.warBrief?.trim()) {
      user += `\n\nLast watch brief (persistent):\n${input.warBrief}`;
    }
    if (input.sharedWarPicture?.trim()) {
      user += `\n\n${wrapUntrusted("live war picture (cite army ids/provinces; do not invent)", input.sharedWarPicture)}`;
    }
    if (input.peerBriefings?.trim()) {
      user += `\n\nCabinet table so far (authoritative peer briefs — use these numbers; do not ask peers to repeat):\n${input.peerBriefings}`;
    }
    if (input.reactionPass) {
      user += `\n\nThis is the reaction pass. Revise your public_line to answer the player AND react to peers (agree / challenge / add the missing piece). Do not repeat your previous speech verbatim. Do not claim you lack data a peer already provided.`;
    }
    const preloaded = await this.preloadSeatData(
      input.seat,
      input.question,
      input.skipWarPictureFetch,
    );
    if (preloaded.text) {
      user += `\n\n${wrapUntrusted("preloaded tool data (cite these; do not invent)", preloaded.text)}`;
    }
    const sensorFallback = this.buildSensorFallback(
      input.seat,
      input.question,
      preloaded.resourceSummary,
      input.sharedWarPicture ?? input.warBrief,
      preloaded.warSnap,
    );
    const tier = input.useQualityModel ? "quality" : "fast";

    for (let attempt = 0; attempt <= COST_CAPS.maxJsonRetry + 2; attempt++) {
      const raw = await this.nvidia.chat({
        tier,
        system,
        user,
        json: true,
      });
      let parsed: unknown;
      try {
        parsed = extractJsonObject(raw);
      } catch {
        user += `\n\nPrevious output was not valid JSON. Return valid JSON only.`;
        continue;
      }

      const obj = parsed as Record<string, unknown>;
      if (obj.tool_request && typeof obj.tool_request === "object") {
        const tr = obj.tool_request as {
          name?: string;
          args?: Record<string, unknown>;
        };
        const name = tr.name as SensorToolName;
        try {
          const result = await this.gateway.call(
            input.seat.id,
            input.seat.dataScopes,
            name,
            tr.args ?? {},
          );
          user += `\n\n${wrapUntrusted(`tool ${name} result`, JSON.stringify(result).slice(0, 6000))}\n\nNow return final MinisterOutput JSON (no tool_request).`;
        } catch (err) {
          user += `\n\nTool ${name} failed: ${err instanceof Error ? err.message : String(err)}\nReturn final JSON with concerns noting the failure.`;
        }
        continue;
      }

      const out = MinisterOutputSchema.safeParse(parsed);
      if (out.success) {
        return this.ensurePublicLine(out.data, sensorFallback);
      }
      user += `\n\nSchema error: ${out.error.message}. Fix and return JSON.`;
    }

    if (sensorFallback) {
      return {
        facts: [sensorFallback],
        concerns: ["minister JSON weak — sensor sitrep used"],
        proposals: [],
        need_from: [],
        draft_message: null,
        public_line: sensorFallback,
      };
    }

    return {
      facts: [],
      concerns: ["minister failed to produce valid JSON"],
      proposals: [],
      need_from: [],
      draft_message: null,
      public_line: `${input.seat.name}: no usable assessment this turn.`,
    };
  }

  private buildSensorFallback(
    seat: SeatDefinition,
    question: string,
    resourceSummary: string | null,
    warBrief: string | undefined,
    warSnap: Parameters<typeof formatWarSituationAnswer>[0],
  ): string | null {
    if (resourceSummary) return resourceSummary;
    const warSeat =
      seat.id === "war" || seat.id === "defense" || seat.id === "intel";
    if (!warSeat) return null;
    return (
      formatWarSituationAnswer(warSnap, question) ||
      formatWarSituationFromBrief(warBrief, question)
    );
  }

  /** Pull scoped sensors before the LLM so Q&A cannot skip tools. */
  private async preloadSeatData(
    seat: SeatDefinition,
    question: string,
    skipWarPictureFetch = false,
  ): Promise<{
    text: string;
    resourceSummary: string | null;
    warSnap: Parameters<typeof formatWarSituationAnswer>[0];
  }> {
    const q = question.toLowerCase();
    const economyAsk =
      seat.id === "finance" ||
      /econom|resource|stock|income|rate|produc|consum|money|grain|oil|market|build|budget|fisch|geld|improve/i.test(
        q,
      );
    const warSeat =
      seat.id === "war" || seat.id === "defense" || seat.id === "intel";
    const warAsk =
      warSeat ||
      /invas|attack|war|army|armies|push|offen|canada|front|garrison|defend|hold|bombard|naval|fleet|coast/i.test(
        q,
      );

    const tools: SensorToolName[] = [];
    const push = (name: SensorToolName) => {
      if (seat.dataScopes.includes(name) && !tools.includes(name)) {
        tools.push(name);
      }
    };

    // War picture is prefetched once by Chief — do not re-fetch per seat.
    if ((warSeat || warAsk) && !skipWarPictureFetch) {
      push("get_war_picture");
    }
    if (economyAsk) {
      push("get_resources");
      if (seat.id === "finance") push("get_market");
    }
    if (warAsk && !warSeat && !skipWarPictureFetch) {
      push("get_own_armies");
      push("get_world_summary");
    }
    if (seat.id === "intel" && !tools.includes("get_spies") && !skipWarPictureFetch) {
      push("get_spies");
    }
    if (
      seat.id === "intel" ||
      seat.id === "war" ||
      seat.id === "defense" ||
      seat.id === "finance"
    ) {
      push("get_stats");
    }
    if (seat.id === "foreign") {
      push("get_relations");
      push("get_messages");
    }
    if (seat.id === "finance" && /build|airfield|airport|upgrade|belinyu|harbor|factory/i.test(q)) {
      // list_province_upgrades needs province arg — filled after relations/messages if named
    }
    if (!tools.length && !skipWarPictureFetch) push("current_game");

    const chunks: string[] = [];
    let resourceSummary: string | null = null;
    let warSnap: Parameters<typeof formatWarSituationAnswer>[0] = null;
    let messagesDump: unknown = null;
    let resourcesRaw: unknown = null;
    let marketRaw: unknown = null;
    const dataDir =
      process.env.CABINET_DATA_DIR?.trim() || "data/cabinet";
    const toolLimit =
      seat.id === "foreign" ? COST_CAPS.maxToolCallsPerMinister : COST_CAPS.maxToolCallsPerMinister;

    // When war picture is prefetched by Chief, still load last snapshot for sitrep fallback.
    if (
      skipWarPictureFetch &&
      (seat.id === "war" || seat.id === "defense" || seat.id === "intel")
    ) {
      try {
        const { CabinetMemory } = await import("./memory.js");
        const mem = new CabinetMemory(dataDir);
        const saved = await mem.loadWarPicture<
          NonNullable<Parameters<typeof formatWarSituationAnswer>[0]>
        >();
        if (saved) warSnap = saved;
      } catch {
        /* optional */
      }
    }

    for (const name of tools.slice(0, toolLimit)) {
      try {
        const result = await this.gateway.call(
          seat.id,
          seat.dataScopes,
          name,
          {},
        );
        if (name === "get_war_picture") {
          const pic = result as WarPictureRaw;
          const scored = scoreWarPicture(pic, null);
          warSnap = scored;
          chunks.push(
            `get_war_picture:\n${formatWarBriefing(scored, pic, COST_CAPS.maxWarBriefChars)}`,
          );
        } else if (name === "get_own_armies") {
          chunks.push(`${name}: ${summarizeArmies(result)}`);
        } else if (name === "get_messages") {
          messagesDump = result;
          chunks.push(`${name}: ${JSON.stringify(result).slice(0, 5000)}`);
        } else if (name === "get_resources") {
          resourcesRaw = result;
          resourceSummary = formatResourceSummary(result);
          chunks.push(`${name}: ${JSON.stringify(result).slice(0, 2500)}`);
        } else if (name === "get_market") {
          marketRaw = result;
          chunks.push(`${name}: ${JSON.stringify(result).slice(0, 2500)}`);
        } else if (name === "get_stats") {
          chunks.push(`${name}:\n${formatStatsStrip(result)}`);
        } else if (name === "get_spies" && seat.id === "intel") {
          chunks.push(`${name}: ${JSON.stringify(result).slice(0, 3000)}`);
          try {
            const { addIntelEvent } = await import("./intel-events.js");
            const agents =
              (result as { agents?: Array<{ province?: string; mission?: string }> })
                ?.agents ?? [];
            for (const a of agents.slice(0, 8)) {
              await addIntelEvent(dataDir, {
                source: "spy",
                location: a.province ?? "unknown",
                confidence: 0.75,
                observed: `spy ${a.mission ?? "mission"} @ ${a.province ?? "?"}`,
              });
            }
          } catch {
            /* ignore */
          }
        } else {
          chunks.push(`${name}: ${JSON.stringify(result).slice(0, 4500)}`);
        }
      } catch (err) {
        chunks.push(
          `${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (seat.id === "finance" && (resourcesRaw || marketRaw)) {
      try {
        const { refreshFinanceFromTools, formatFinanceBrief } = await import(
          "./finance-model.js"
        );
        const { formatMarketDigest } = await import("./market-engine.js");
        const state = await refreshFinanceFromTools(
          dataDir,
          resourcesRaw,
          marketRaw,
        );
        chunks.push(
          `finance_model:\n${formatFinanceBrief(state)}\n${formatMarketDigest(state)}`,
        );
      } catch (err) {
        chunks.push(
          `finance_model failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Detect embargo mentions in relations/messages for Finance
    if (seat.id === "finance" || seat.id === "foreign") {
      try {
        const blob = JSON.stringify(messagesDump ?? "").toLowerCase();
        if (/embargo|sanction|trade block/i.test(blob)) {
          const { recordEmbargo } = await import("./finance-model.js");
          await recordEmbargo(dataDir, {
            note: "detected in messages/relations dump",
          });
        }
      } catch {
        /* ignore */
      }
    }

    // Foreign: pull full thread when nation/player is named in the question.
    if (seat.id === "foreign" && seat.dataScopes.includes("get_thread")) {
      let playerId = resolvePlayerIdFromText(q, messagesDump);
      if (playerId == null && messagesDump && typeof messagesDump === "object") {
        const threads = (messagesDump as { threads?: Array<{ otherPlayerId?: number; other?: { nation?: string } }> }).threads ?? [];
        for (const t of threads) {
          const nation = (t.other?.nation ?? "").toLowerCase();
          if (nation && q.toLowerCase().includes(nation.split(/\s+/)[0]!)) {
            playerId = t.otherPlayerId ?? null;
            break;
          }
          if (/malay/i.test(q) && /malay/i.test(nation)) {
            playerId = t.otherPlayerId ?? null;
            break;
          }
        }
      }
      if (playerId != null) {
        try {
          const thread = await this.gateway.call(
            seat.id,
            seat.dataScopes,
            "get_thread",
            { playerId },
          );
          chunks.push(
            `get_thread (FULL — cite when judging deals/offers):\n${formatThreadTranscript(thread)}`,
          );
        } catch (err) {
          chunks.push(
            `get_thread failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Finance: when a province is named for builds, list live upgrades.
    if (
      seat.id === "finance" &&
      seat.dataScopes.includes("list_province_upgrades")
    ) {
      const provMatch = q.match(
        /\b(Belinyu|Juneau|Sitka|Papeete|Whitehorse|Honolulu|Prince George|Iskut)\b/i,
      );
      if (provMatch?.[1]) {
        try {
          const ups = await this.gateway.call(
            seat.id,
            seat.dataScopes,
            "list_province_upgrades",
            { provinceIdOrName: provMatch[1] },
          );
          chunks.push(
            `list_province_upgrades ${provMatch[1]} (ONLY use these upgradeIds for constructBuilding):\n${JSON.stringify(ups).slice(0, 4000)}`,
          );
        } catch (err) {
          chunks.push(
            `list_province_upgrades failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return { text: chunks.join("\n"), resourceSummary, warSnap };
  }

  private ensurePublicLine(
    out: MinisterOutput,
    sensorFallback: string | null,
  ): MinisterOutput {
    const line = out.public_line.trim();
    const tooThin =
      !line ||
      (sensorFallback != null &&
        line.length < 80 &&
        !/\bstock\b|\brate\b|\d{2,}|vs\b|hostile|near /i.test(line));
    if (!tooThin) return out;
    if (sensorFallback) {
      const merged = line ? `${sensorFallback} — ${line}` : sensorFallback;
      return { ...out, public_line: merged };
    }
    if (out.facts.length) {
      return { ...out, public_line: out.facts.slice(0, 4).join(" · ") };
    }
    return out;
  }
}

/** Pull a JSON object from model output (fences / leading prose). */
function extractJsonObject(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new Error("empty model output");
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("no JSON object");
}

function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/** Prefer live `rate`; production/consumption are period totals, not the UI net. */
function formatResourceSummary(raw: unknown): string | null {
  const bag =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { money?: number; resources?: unknown[] })
      : null;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(bag?.resources)
      ? bag.resources
      : null;
  if (!rows?.length && !Number.isFinite(Number(bag?.money))) {
    return null;
  }
  const parts: string[] = [];
  const money = Number(bag?.money);
  if (Number.isFinite(money)) parts.push(`money ${Math.round(money)}`);
  const bleeders: string[] = [];
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? r.id ?? "?");
    const amount = Number(r.amount);
    if (!Number.isFinite(amount)) continue;
    const rateRaw = Number(r.rate);
    const prod = Number(r.production);
    const cons = Number(r.consumption);
    const net = Number.isFinite(rateRaw)
      ? rateRaw
      : Number.isFinite(prod) && Number.isFinite(cons)
        ? prod - cons
        : NaN;
    if (Number.isFinite(net)) {
      const sign = net >= 0 ? "+" : "";
      parts.push(`${name} stock ${Math.round(amount)} rate ${sign}${fmtRate(net)}`);
      if (net < 0) bleeders.push(name);
    } else {
      parts.push(`${name} stock ${Math.round(amount)}`);
    }
  }
  if (!parts.length) return null;
  const flag = bleeders.length
    ? ` BLEEDING: ${bleeders.join(", ")}.`
    : " No resource bleeding.";
  return `Economy — ${parts.join("; ")}.${flag}`;
}

function summarizeArmies(raw: unknown): string {
  if (!Array.isArray(raw)) return JSON.stringify(raw).slice(0, 4500);
  const lines = raw.slice(0, 40).map((a) => {
    if (!a || typeof a !== "object") return String(a);
    const o = a as Record<string, unknown>;
    const units = Array.isArray(o.units)
      ? o.units
          .map((u) => {
            if (!u || typeof u !== "object") return "?";
            const uu = u as Record<string, unknown>;
            return `${uu.size ?? uu.count ?? "?"}×${uu.name ?? uu.type ?? "?"}`;
          })
          .join(", ")
      : "";
    const pos =
      o.pos && typeof o.pos === "object"
        ? ` @${(o.pos as { x?: number; y?: number }).x},${(o.pos as { x?: number; y?: number }).y}`
        : "";
    return `army ${o.id} @ ${o.province ?? "?"}${pos}${o.onSea ? " (sea)" : ""} [${units}]`;
  });
  const more = raw.length > 40 ? `\n… +${raw.length - 40} more` : "";
  return `${lines.join("\n")}${more}`;
}
