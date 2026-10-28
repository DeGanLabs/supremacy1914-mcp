import { formatGameTimestamp } from "./display-format.js";

export function formatThreadTranscript(thread: unknown): string {
  if (!thread || typeof thread !== "object") return "(empty thread)";
  const t = thread as {
    other?: { nation?: string; name?: string; playerId?: number };
    otherPlayerId?: number;
    messages?: Array<{
      senderId?: number;
      bodyText?: string;
      timestamp?: number;
      isSystemMessage?: boolean;
    }>;
    openTrades?: unknown[];
    pastTrades?: unknown[];
  };
  const who =
    t.other?.nation ||
    t.other?.name ||
    `player ${t.otherPlayerId ?? t.other?.playerId ?? "?"}`;
  const otherId = t.otherPlayerId ?? t.other?.playerId;
  const lines: string[] = [`Thread with ${who}:`];
  const msgs = t.messages ?? [];
  for (const m of msgs) {
    const body = String(m.bodyText ?? "").trim();
    if (!body) continue;
    const when = formatGameTimestamp(m.timestamp);
    let from = "System";
    if (!m.isSystemMessage) {
      const sid = m.senderId;
      if (sid != null && otherId != null && Number(sid) === Number(otherId)) {
        from = who;
      } else if (sid != null) {
        from = "Us";
      } else {
        from = "Unknown";
      }
    }
    lines.push(`[${when}] ${from}: ${body.slice(0, 800)}`);
  }
  if (!msgs.length) lines.push("(no messages)");
  const trades = t.openTrades ?? [];
  if (trades.length) {
    lines.push(`Open trades (${trades.length}): ${JSON.stringify(trades).slice(0, 1200)}`);
  }
  return lines.join("\n");
}

/** Match a nation/player name from free text against relations or message threads. */
export function resolvePlayerIdFromText(
  question: string,
  relationsOrMessages: unknown,
): number | null {
  const q = question.toLowerCase();
  // Prefer explicit thread index from get_messages
  if (relationsOrMessages && typeof relationsOrMessages === "object") {
    const o = relationsOrMessages as {
      threads?: Array<{
        otherPlayerId?: number;
        other?: { nation?: string; name?: string };
      }>;
      players?: Array<{ id?: number; nation?: string; name?: string }>;
      atWar?: Array<{ id?: number; nation?: string; name?: string }>;
      rows?: Array<{ id?: number; nation?: string; name?: string }>;
    };
    const candidates = [
      ...(o.threads ?? []).map((t) => ({
        id: t.otherPlayerId,
        nation: t.other?.nation,
        name: t.other?.name,
      })),
      ...(o.players ?? []),
      ...(o.atWar ?? []),
      ...(o.rows ?? []),
    ];
    const named = candidates.filter((c) => c.id != null);
    const exact = named.filter((c) => {
      const nation = (c.nation ?? "").toLowerCase();
      const name = (c.name ?? "").toLowerCase();
      return (nation && q === nation) || (name && q === name);
    });
    if (exact.length === 1) return Number(exact[0]!.id);
    const hits = named.filter((c) => {
      const nation = (c.nation ?? "").toLowerCase();
      const name = (c.name ?? "").toLowerCase();
      if (nation && nation.length > 3 && q.includes(nation)) return true;
      if (name && name.length > 3 && q.includes(name)) return true;
      return false;
    });
    if (hits.length === 1) return Number(hits[0]!.id);
  }
  // Common shorthand
  if (/malay/i.test(question)) return null; // need tool resolve
  return null;
}
