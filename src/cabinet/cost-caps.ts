export const COST_CAPS = {
  maxDebateRounds: 2,
  maxToolCallsPerMinister: 4,
  maxJsonRetry: 1,
  /** Soft cap for war briefing chars injected into LLM. */
  maxWarBriefChars: 4500,
  maxChatTranscript: 12,
  maxSeatNotesInject: 8,
  /** Auto-pilot execute cap (rolling hour). */
  maxAutoExecutesPerHour: 8,
} as const;

export type SensorToolName =
  | "get_resources"
  | "get_relations"
  | "get_diplomacy"
  | "get_own_armies"
  | "get_world_summary"
  | "get_war_picture"
  | "get_messages"
  | "get_thread"
  | "get_market"
  | "get_spies"
  | "get_news"
  | "get_heroes"
  | "get_stats"
  | "list_province_upgrades"
  | "get_finance_picture"
  | "current_game";

/** Tools each seat may call (enforced in gateway). */
export const DEFAULT_SEAT_SCOPES: Record<string, readonly SensorToolName[]> = {
  foreign: [
    "get_relations",
    "get_diplomacy",
    "get_messages",
    "get_thread",
    "get_news",
    "current_game",
  ],
  war: [
    "get_war_picture",
    "get_own_armies",
    "get_world_summary",
    "get_relations",
    "get_heroes",
    "get_spies",
    "get_stats",
    "current_game",
  ],
  defense: [
    "get_war_picture",
    "get_own_armies",
    "get_world_summary",
    "get_relations",
    "get_stats",
    "current_game",
  ],
  finance: [
    "get_finance_picture",
    "get_resources",
    "get_market",
    "get_own_armies",
    "list_province_upgrades",
    "get_relations",
    "get_stats",
    "current_game",
  ],
  intel: [
    "get_war_picture",
    "get_spies",
    "get_world_summary",
    "get_news",
    "get_messages",
    "get_relations",
    "get_stats",
    "current_game",
  ],
  /** Watch loop seat — full picture without stealing minister caps. */
  "war-watch": ["get_war_picture", "current_game"],
  "finance-watch": [
    "get_resources",
    "get_market",
    "get_relations",
    "get_world_summary",
    "list_province_upgrades",
    "get_finance_picture",
    "current_game",
  ],
};
