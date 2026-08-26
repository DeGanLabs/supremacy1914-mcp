import type { SensorToolName } from "../cabinet/cost-caps.js";

/** Catalog of Phase-1 sensor tools (current open tab only). */
export const SENSOR_TOOLS: Record<
  SensorToolName,
  { readonly description: string; readonly requiresArgs?: string[] }
> = {
  current_game: { description: "Open tab game identity (gameId, playerId, day)" },
  get_resources: { description: "Player resource stockpile and rates" },
  get_relations: { description: "Diplomacy relation matrix summary" },
  get_diplomacy: { description: "Alias of get_relations" },
  get_own_armies: { description: "Own armies with province and units" },
  get_world_summary: { description: "Country province/army counts (FoW)" },
  get_war_picture: {
    description:
      "Compressed war picture: wars, borders, fronts, own/foreign armies, spies, heroes",
  },
  get_messages: { description: "Recent diplomacy messages and trades" },
  get_thread: {
    description: "Messages/trades with one player",
    requiresArgs: ["playerId|name"],
  },
  get_market: { description: "Stock market offers" },
  get_spies: { description: "Spy agents and intel" },
  get_news: { description: "Newspaper articles for a day" },
  get_heroes: { description: "Hero inventory and deployed heroes" },
  get_stats: {
    description: "Game clock, ranking, combat K/D, province morale/VP",
  },
  list_province_upgrades: {
    description: "Live construction upgrade ids/names for a province",
    requiresArgs: ["provinceIdOrName"],
  },
  get_finance_picture: {
    description:
      "Own-province finance dump (capitals, morale, buildings) for Command Center",
  },
};

export const PHASE1_ACTION_METHODS = [
  "moveArmy",
  "constructBuilding",
  "attackArmy",
  "delayArmy",
] as const;

export function isSensorTool(name: string): name is SensorToolName {
  return Object.prototype.hasOwnProperty.call(SENSOR_TOOLS, name);
}
