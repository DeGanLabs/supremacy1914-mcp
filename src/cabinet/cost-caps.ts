export const COST_CAPS = {
  maxDebateRounds: 2,
  maxToolCallsPerMinister: 4,
  maxJsonRetry: 1,
  /** Soft cap for war briefing chars injected into LLM. */
  maxWarBriefChars: 4500,
  maxChatTranscript: 24,
  maxTranscriptChars: 1200,
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
  | "current_game"
  | "list_games"
  | "use_game"
  | "send_diplo"
  | "deploy_hero";

/** Tools each seat may call (enforced in gateway). */
export const DEFAULT_SEAT_SCOPES: Record<string, readonly SensorToolName[]> = {
  foreign: [
    "get_relations",
    "get_diplomacy",
    "get_messages",
    "get_thread",
    "get_news",
    "current_game",
    "list_games",
    "send_diplo",
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
    "list_games",
    "deploy_hero",
  ],
  defense: [
    "get_war_picture",
    "get_own_armies",
    "get_world_summary",
    "get_relations",
    "get_stats",
    "current_game",
    "list_games",
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
    "list_games",
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
    "list_games",
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
  /** External MCP / HTTP agents — full sensor catalog. */
  mcp: [
    "get_resources",
    "get_relations",
    "get_diplomacy",
    "get_own_armies",
    "get_world_summary",
    "get_war_picture",
    "get_messages",
    "get_thread",
    "get_market",
    "get_spies",
    "get_news",
    "get_heroes",
    "get_stats",
    "list_province_upgrades",
    "get_finance_picture",
    "current_game",
    "list_games",
    "use_game",
    "send_diplo",
    "deploy_hero",
  ],
};
