export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Mutating tools require S1914_MCP_WRITES=1 and confirm:true */
  write?: boolean;
  /** Handled in Node (not page rpc), e.g. health */
  local?: boolean;
}

const confirmProp = {
  confirm: {
    type: "boolean",
    description: "Must be true to execute this write action",
  },
} as const;

function writeSchema(
  properties: Record<string, unknown>,
  required: string[],
): JsonSchema {
  return {
    type: "object",
    properties: { ...properties, ...confirmProp },
    required: [...required, "confirm"],
    additionalProperties: false,
  };
}

function readSchema(
  properties: Record<string, unknown> = {},
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties: {
      ...properties,
      fresh: {
        type: "boolean",
        description: "Skip the ~10s read cache and hit the live client",
      },
    },
    required,
    additionalProperties: false,
  };
}

export const TOOLS: ToolDef[] = [
  {
    name: "health",
    description:
      "Browser session health: loggedIn, hupReady, injectOk, gameId, playerId, page URL",
    inputSchema: readSchema(),
    local: true,
  },
  {
    name: "ensure_ready",
    description:
      "Bootstrap for agents: start browser, optional auto-login (S1914_EMAIL/PASSWORD), open gameId, inject helpers. Call this first.",
    inputSchema: readSchema({
      gameId: {
        type: "number",
        description: "Joined game id to open (from list_games)",
      },
      login: {
        type: "boolean",
        description: "Attempt auto-login if needed (default true when env creds set)",
      },
    }),
    local: true,
  },
  {
    name: "login",
    description:
      "Auto-login using S1914_EMAIL + S1914_PASSWORD (or manual once in Playwright window)",
    inputSchema: readSchema(),
    local: true,
  },
  {
    name: "open_game",
    description:
      "Deep-link to a game id, wait for Ultimate client (hup), reinject helpers",
    inputSchema: readSchema(
      { gameId: { type: "number", description: "Game id" } },
      ["gameId"],
    ),
    local: true,
  },
  {
    name: "list_games",
    description:
      "List joined maps (getMyGames) with index, gameId, title, day. Works from lobby after login — no ensure_ready(gameId) needed.",
    inputSchema: readSchema(),
  },
  {
    name: "current_game",
    description: "Identity of the currently open game tab",
    inputSchema: readSchema(),
  },
  {
    name: "use_game",
    description:
      "Switch to a joined game by gameId or list index (reinjects after load)",
    inputSchema: readSchema(
      {
        gameId: { type: "number", description: "Game id" },
        index: { type: "number", description: "Index from list_games" },
      },
      [],
    ),
  },
  {
    name: "get_own_armies",
    description: "Own armies with province and units",
    inputSchema: readSchema(),
  },
  {
    name: "get_war_picture",
    description: "Compressed war picture: wars, borders, fronts, armies, spies, heroes",
    inputSchema: readSchema({
      summaryOnly: { type: "boolean" },
    }),
  },
  {
    name: "get_world_summary",
    description: "Country province/army counts (fog of war)",
    inputSchema: readSchema(),
  },
  {
    name: "get_resources",
    description: "Player resource stockpile and rates",
    inputSchema: readSchema(),
  },
  {
    name: "get_relations",
    description: "Diplomacy relation matrix summary",
    inputSchema: readSchema(),
  },
  {
    name: "get_messages",
    description: "Recent diplomacy messages and trades",
    inputSchema: readSchema(),
  },
  {
    name: "get_thread",
    description: "Messages/trades with one player",
    inputSchema: readSchema({
      playerId: { type: "number" },
      name: { type: "string" },
      playerIdOrName: { type: ["string", "number"] },
    }),
  },
  {
    name: "get_market",
    description: "Stock market book (optional resource filter)",
    inputSchema: readSchema({
      resourceId: { type: "number" },
      depth: { type: "number" },
    }),
  },
  {
    name: "get_spies",
    description: "Spy agents and intel",
    inputSchema: readSchema({
      includeAllDays: { type: "boolean" },
    }),
  },
  {
    name: "get_heroes",
    description: "Hero inventory and deployed heroes",
    inputSchema: readSchema(),
  },
  {
    name: "get_news",
    description: "Newspaper articles for a day",
    inputSchema: readSchema({
      day: { type: "number" },
      onlyPlayer: { type: "boolean" },
    }),
  },
  {
    name: "get_stats",
    description: "Game clock, ranking, combat K/D, province morale/VP",
    inputSchema: readSchema(),
  },
  {
    name: "get_finance_picture",
    description: "Own-province finance dump (capitals, morale, buildings)",
    inputSchema: readSchema(),
  },
  {
    name: "map_screenshot",
    description:
      "Pan/zoom the live map and return a short-lived public PNG URL (expires ~15m). Focus via x/y, provinceIdOrName, or armyId.",
    inputSchema: readSchema({
      x: { type: "number", description: "Map X (army pos / province capital)" },
      y: { type: "number", description: "Map Y" },
      provinceIdOrName: {
        type: ["string", "number"],
        description: "Focus province capital",
      },
      armyId: { type: "number", description: "Focus army position" },
      zoom: {
        type: "string",
        enum: ["far", "mid", "near"],
        description: "Zoom preset",
      },
      label: { type: "string", description: "Caption stored with the shot" },
      waitMs: {
        type: "number",
        description: "Settle time after pan before capture (default 800)",
      },
    }),
    local: true,
  },
  {
    name: "list_province_upgrades",
    description: "Live construction upgrade ids/names for a province",
    inputSchema: readSchema(
      { provinceIdOrName: { type: ["string", "number"] } },
      ["provinceIdOrName"],
    ),
  },
  {
    name: "dump_province_slots",
    description: "Active constructions/productions in a province",
    inputSchema: readSchema(
      { provinceIdOrName: { type: ["string", "number"] } },
      ["provinceIdOrName"],
    ),
  },
  {
    name: "set_building_enabled",
    description:
      "Enable or disable a finished building in one province (UI AKTIVIEREN/DEAKTIVIEREN). Saves daily cost when disabled.",
    inputSchema: writeSchema(
      {
        provinceIdOrName: { type: ["string", "number"] },
        upgradeId: { type: "number", description: "e.g. 21 = Recruiting Office" },
        upgradeName: {
          type: "string",
          description: 'e.g. "Recruiting Office"',
        },
        enabled: { type: "boolean" },
      },
      ["provinceIdOrName", "enabled"],
    ),
    write: true,
  },
  {
    name: "bulk_set_building_enabled",
    description:
      "Enable/disable one building type across many (or all own) provinces that already have it built.",
    inputSchema: writeSchema(
      {
        upgradeId: { type: "number" },
        upgradeName: { type: "string" },
        enabled: { type: "boolean" },
        provinceIds: {
          type: "array",
          items: { type: "number" },
          description: "Omit to target all own provinces with that building",
        },
      },
      ["enabled"],
    ),
    write: true,
  },
  {
    name: "move_army",
    description: "Move one army to map coords (live client pathfinding)",
    inputSchema: writeSchema(
      {
        armyId: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        append: { type: "boolean" },
      },
      ["armyId", "x", "y"],
    ),
    write: true,
  },
  {
    name: "move_armies",
    description: "Move multiple armies to the same coords",
    inputSchema: writeSchema(
      {
        armyIds: { type: "array", items: { type: "number" } },
        armyId: { type: "number", description: "Single id alternative" },
        x: { type: "number" },
        y: { type: "number" },
        append: { type: "boolean" },
      },
      ["x", "y"],
    ),
    write: true,
  },
  {
    name: "attack_army",
    description: "Path + attack/bombard a target army",
    inputSchema: writeSchema(
      {
        armyId: { type: "number" },
        targetArmyId: { type: "number" },
      },
      ["armyId", "targetArmyId"],
    ),
    write: true,
  },
  {
    name: "delay_army",
    description: "UI Delay on an army (minutes of game UI time)",
    inputSchema: writeSchema(
      {
        armyId: { type: "number" },
        minutes: { type: "number" },
        syncArrival: { type: "boolean" },
      },
      ["armyId", "minutes"],
    ),
    write: true,
  },
  {
    name: "set_forced_march",
    description: "Toggle forced march on an army",
    inputSchema: writeSchema(
      {
        armyId: { type: "number" },
        enabled: { type: "boolean" },
      },
      ["armyId", "enabled"],
    ),
    write: true,
  },
  {
    name: "set_aggression",
    description: "Set army aggressiveness 1–5 (0 = default)",
    inputSchema: writeSchema(
      {
        armyId: { type: "number" },
        level: { type: "number" },
      },
      ["armyId", "level"],
    ),
    write: true,
  },
  {
    name: "deploy_hero",
    description: "Deploy a hero from inventory to a province",
    inputSchema: writeSchema(
      {
        heroIdOrName: { type: ["string", "number"] },
        provinceIdOrName: { type: ["string", "number"] },
      },
      ["heroIdOrName", "provinceIdOrName"],
    ),
    write: true,
  },
  {
    name: "construct_building",
    description: "Start or queue a building upgrade in a province",
    inputSchema: writeSchema(
      {
        provinceIdOrName: { type: ["string", "number"] },
        upgradeId: { type: "number" },
      },
      ["provinceIdOrName", "upgradeId"],
    ),
    write: true,
  },
  {
    name: "produce_unit",
    description: "Produce a unit type in a province",
    inputSchema: writeSchema(
      {
        provinceIdOrName: { type: ["string", "number"] },
        unitTypeId: { type: "number" },
      },
      ["provinceIdOrName", "unitTypeId"],
    ),
    write: true,
  },
  {
    name: "enqueue_build",
    description: "Add a building to the global build queue",
    inputSchema: writeSchema(
      {
        provinceIdOrName: { type: ["string", "number"] },
        upgradeId: { type: "number" },
      },
      ["provinceIdOrName", "upgradeId"],
    ),
    write: true,
  },
  {
    name: "cancel_building",
    description: "Cancel building construction in a province slot",
    inputSchema: writeSchema(
      {
        provinceIdOrName: { type: ["string", "number"] },
        slot: { type: "number" },
      },
      ["provinceIdOrName"],
    ),
    write: true,
  },
  {
    name: "cancel_unit_production",
    description: "Cancel unit production in a province slot",
    inputSchema: writeSchema(
      {
        provinceIdOrName: { type: ["string", "number"] },
        slot: { type: "number" },
      },
      ["provinceIdOrName"],
    ),
    write: true,
  },
  {
    name: "place_market_order",
    description: "Place a resting buy/sell market order",
    inputSchema: writeSchema(
      {
        side: { type: "string", enum: ["buy", "sell"] },
        resourceId: { type: "number" },
        amount: { type: "number" },
        limit: { type: "number" },
      },
      ["side", "resourceId", "amount", "limit"],
    ),
    write: true,
  },
  {
    name: "accept_market_order",
    description: "Take amount from an existing book order",
    inputSchema: writeSchema(
      {
        orderId: { type: "number" },
        amount: { type: "number" },
      },
      ["orderId", "amount"],
    ),
    write: true,
  },
  {
    name: "cancel_market_order",
    description: "Cancel one of your market orders",
    inputSchema: writeSchema(
      { orderId: { type: "number" } },
      ["orderId"],
    ),
    write: true,
  },
  {
    name: "send_message",
    description: "Send an in-game diplomacy message",
    inputSchema: writeSchema(
      {
        playerIdOrName: { type: ["string", "number"] },
        playerId: { type: "number" },
        name: { type: "string" },
        text: { type: "string" },
      },
      ["text"],
    ),
    write: true,
  },
  {
    name: "set_relation",
    description:
      "Change diplomatic relation (-2 war … 3 RoW … 7 military authority)",
    inputSchema: writeSchema(
      {
        playerIdOrName: { type: ["string", "number"] },
        playerId: { type: "number" },
        name: { type: "string" },
        relation: { type: "number" },
      },
      ["relation"],
    ),
    write: true,
  },
  {
    name: "create_trade_offer",
    description:
      "Create a player trade (offer/ask maps: resourceId→amount; 15=province; 17=relation)",
    inputSchema: writeSchema(
      {
        playerIdOrName: { type: ["string", "number"] },
        playerId: { type: "number" },
        name: { type: "string" },
        offer: { type: "object", additionalProperties: { type: "number" } },
        ask: { type: "object", additionalProperties: { type: "number" } },
        message: { type: "string" },
      },
      [],
    ),
    write: true,
  },
  {
    name: "respond_trade_offer",
    description: "Accept, refuse, delete, or mark-read a trade offer",
    inputSchema: writeSchema(
      {
        tradeId: { type: "number" },
        tradeOfferId: { type: "number" },
        action: {
          type: "string",
          enum: ["accept", "refuse", "delete", "read"],
        },
      },
      ["action"],
    ),
    write: true,
  },
  {
    name: "write_news",
    description: "Publish a newspaper article",
    inputSchema: writeSchema(
      {
        title: { type: "string" },
        body: { type: "string" },
        anonymous: { type: "boolean" },
      },
      ["title", "body"],
    ),
    write: true,
  },
  {
    name: "inspect_province",
    description:
      "One province card: coords, owner, morale, buildings (full if own, fog if foreign), neighbours",
    inputSchema: readSchema({
      provinceIdOrName: { type: ["string", "number"] },
      x: { type: "number" },
      y: { type: "number" },
    }),
  },
  {
    name: "stop_army",
    description: "Cancel an army's current movement/attack commands",
    inputSchema: writeSchema(
      { armyId: { type: "number" } },
      ["armyId"],
    ),
    write: true,
  },
  {
    name: "split_army",
    description:
      "Peel units into a new stack (e.g. 10 infantry). Requires the live client split API.",
    inputSchema: writeSchema(
      {
        armyId: { type: "number" },
        units: {
          type: "array",
          items: {
            type: "object",
            properties: {
              typeId: { type: "number" },
              name: { type: "string" },
              count: { type: "number" },
            },
            required: ["count"],
          },
        },
      },
      ["armyId", "units"],
    ),
    write: true,
  },
  {
    name: "preview_army_order",
    description:
      "Dry-run a move or attack: validity, destination, rough ETA, diplomatic note. Does not send the order. costs is null unless the client exposes them. No invented combat odds.",
    inputSchema: readSchema(
      {
        armyId: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        provinceIdOrName: { type: ["string", "number"] },
        mode: { type: "string", enum: ["move", "attack"] },
      },
      ["armyId", "mode"],
    ),
  },
  {
    name: "campaign_snapshot",
    description:
      "Save a campaign digest (provinces, armies, resources, wars) and append a diff event if it changed",
    inputSchema: readSchema(),
    local: true,
  },
  {
    name: "campaign_diff",
    description:
      "Changes since the previous snapshot (or since an ISO time): lost/gained provinces, army moves, resource deltas, new threats",
    inputSchema: readSchema({
      since: { type: "string", description: "ISO timestamp; default previous snapshot" },
    }),
    local: true,
  },
  {
    name: "campaign_history",
    description: "Recent campaign events (snapshots and diffs)",
    inputSchema: readSchema({
      limit: { type: "number" },
    }),
    local: true,
  },
  {
    name: "get_provinces",
    description:
      "Filtered province page. Default include is resource and morale. Resource names are catalog-validated. Buildings are grouped by base name with upgrade ids and enabled scope.",
    inputSchema: readSchema({
      provinceIdOrName: { type: ["string", "number"] },
      provinceIds: { type: "array", items: { type: ["string", "number"] } },
      x: { type: "number" },
      y: { type: "number" },
      owner: { type: ["string", "number"], description: "self, visible, or playerId" },
      resource: { type: "string" },
      moraleBelow: { type: "number" },
      building: { type: "string" },
      enabled: { type: "boolean" },
      coastal: { type: "boolean" },
      include: { type: "array", items: { type: "string" } },
      limit: { type: "number" },
      cursor: { type: "string" },
      summaryOnly: { type: "boolean" },
    }),
  },
  {
    name: "get_economy",
    description:
      "Stocks, allocation sliders if the client exposes them, producers, and a straight-line forecast. Does not change sliders.",
    inputSchema: readSchema({
      include: { type: "array", items: { type: "string" } },
      days: { type: "number" },
    }),
  },
  {
    name: "get_players",
    description:
      "Players with ranking and victory points only when a real getter exists. Fogged counts stay labeled unknown.",
    inputSchema: readSchema({
      playerIds: { type: "array" },
      names: { type: "array" },
    }),
  },
  {
    name: "get_military",
    description:
      "Own armies and foreign armies the client currently exposes, plus optional borderThreats. No battle simulation.",
    inputSchema: readSchema({
      include: { type: "array", items: { type: "string" } },
    }),
  },
  {
    name: "preview_actions",
    description:
      "Read-only plan bound to the open gameId and sessionVersion. Expires in 10 minutes. Does not send orders.",
    inputSchema: readSchema(
      {
        actions: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
      },
      ["actions"],
    ),
    local: true,
  },
  {
    name: "execute_actions",
    description:
      "Run a previewId on the same game and sessionVersion. Acceptance is not verification.",
    inputSchema: writeSchema({ previewId: { type: "string" } }, ["previewId"]),
    write: true,
    local: true,
  },
  {
    name: "verify_actions",
    description:
      "Fresh read after execute. Status is verified, failed, or unknown. Includes observed resource deltas, not estimates.",
    inputSchema: readSchema({ previewId: { type: "string" } }, ["previewId"]),
    local: true,
  },
  {
    name: "get_connector_capabilities",
    description:
      "Which probes have succeeded in this process: resource catalog, allocation, victory points, enabled scope.",
    inputSchema: readSchema(),
    local: true,
  },
  {
    name: "get_operations",
    description:
      "Running Operations / Hero Pass: point objectives (unit kills, capital captures, hero defeats), leveling advice, and live progress when the client exposes it. Never buys Battle Pass.",
    inputSchema: readSchema({
      probeOnly: {
        type: "boolean",
        description: "Return raw controller discovery instead of the agent-facing summary",
      },
    }),
  },
];

export function writesEnabled(): boolean {
  return process.env.S1914_MCP_WRITES?.trim() === "1";
}

export function assertWriteAllowed(
  tool: ToolDef,
  args: Record<string, unknown>,
): void {
  if (!tool.write) return;
  if (!writesEnabled()) {
    throw new Error(
      `writes disabled — set S1914_MCP_WRITES=1 to allow ${tool.name}`,
    );
  }
  if (args.confirm !== true) {
    throw new Error(
      `${tool.name} requires confirm: true (refusing unconfirmed write)`,
    );
  }
}

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
