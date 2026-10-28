# Tool reference (`mcp-supremacy`)

## Province and economy

`get_provinces` is the province read. Default fields are resource and morale. Add `include` for `buildings`, `production`, `neighbors`, `military`, or `terrain`. `limit` defaults to 100. Resource names are accepted only when they match the client resource catalog.

Buildings are grouped by base name. A level-2 barracks is one building with `upgradeIds`, `enabledScope` (`upgrade` or `building`), and `enabledVerified`.

`get_economy` reads stocks. `include: ["allocation"]` returns slider getters only when the client exposes them. `include: ["producers","forecast"]` adds province output and a straight-line projection.

`preview_actions` does not send orders. It returns `previewId`, `gameId`, and `sessionVersion` (10 minute expiry). `execute_actions` requires that same `previewId` plus `confirm: true` and refuses a different open game. `verify_actions` re-reads the client. Status is `verified`, `failed`, or `unknown`. Observed resource deltas are measured; null is not zero.

`get_connector_capabilities` reports which probes have succeeded in this process.

`get_operations` reads the running Operations / Hero Pass track. It returns point objectives (kill produced unit 20, conquer enemy capital 300, defeat hero 500), leveling advice, and live progress when the Ultimate client exposes a controller. It never buys or unlocks the paid Battle Pass.

## How to call (ChatGPT)

One browser, one queue. Parallel tools time out and jam the server.

1. Call `ensure_ready` with `gameId` **once**.
2. If it says the map is still loading, wait and call `ensure_ready` **once more**. Do not stack other tools.
3. Then call **one** read or write. Wait for it. Then the next.
4. A `queue_busy` error means something else is still running — retry that single tool, do not fan out.
5. `fresh: true` skips the ~10s read cache (`get_resources`, `get_own_armies`, `get_war_picture`, `get_finance_picture`, `list_games`, `get_provinces`, `get_economy`, `get_players`, `get_military`).

Stable error prefixes: `queue_busy`, `map_not_ready`, `op_timeout`, `need_ensure_ready`.

`map_screenshot` stays disabled under Xvfb (capture hangs).

All mutating tools require:

```json
{ "confirm": true }
```

and process env `S1914_MCP_WRITES=1`.

---

## Session

### `health`
No args. Returns `loggedIn`, `hupReady`, `injectOk`, `gameId`, `playerId`, `pageUrl`.

### `ensure_ready`
Bootstrap browser + optional login + open game + inject.

| Arg | Type | Notes |
|---|---|---|
| `gameId` | number | Joined map id |
| `login` | boolean | Auto-login if creds in env (default: try when needed) |

### `login`
Uses `S1914_EMAIL` + `S1914_PASSWORD`. No args.

### `open_game`
| Arg | Required |
|---|---|
| `gameId` | yes |

### `list_games`
Joined maps: `index`, `gameId`, `title`, `day`, `playerId`, `isCurrent`.

### `current_game`
Open tab identity (gameId, day, timeScale, …).

### `use_game`
| Arg | Notes |
|---|---|
| `gameId` | Preferred |
| `index` | From `list_games` |

Deep-links when `gameId` is a real id (>1000).

---

## Read — military / map

### `get_own_armies`
Own stacks: `id`, `province`, `pos {x,y}`, `onSea`, `units[]`, commands/speed flags.

### `get_war_picture`
Compressed situational picture: wars, borders, fronts, own/foreign armies (FoW), spies, heroes.

### `get_world_summary`
Per-country province/army **counts** (FoW). Not full tile dump.

### `get_spies`
Spy agents / intel.

### `get_heroes`
| Field | Meaning |
|---|---|
| `deployable` | Safe to `deploy_hero` **now** |
| `dayOfAvailability` | Scenario day unlock |
| `dayReached` | Current day ≥ unlock day |
| `canDeploy` | obtained ∧ ¬deployed ∧ ¬cooldown ∧ ¬locked ∧ dayReached |
| `deployedOnMap` | Where heroes already sit |

### `get_stats`
Clock, ranking, combat K/D, morale/VP style dumps.

---

## Read — economy / diplo / news

### `get_resources`
Stocks + rates (grain, fish, iron, lumber, coal, oil, gas, money, …).

### `get_finance_picture`
Own provinces: `id`, `name`, `capital {x,y}`, morale, production, buildings.

### `list_province_upgrades` / `dump_province_slots`
| Arg | Required |
|---|---|
| `provinceIdOrName` | yes |

### `get_market`
Book offers (asks/bids) per tradeable resource; inventory/price when available.

### `get_relations` / `get_messages` / `get_thread`
Diplomacy matrix; inbox; thread with one player (`playerId` / `name` / `playerIdOrName`).

### `get_news`
| Arg | Notes |
|---|---|
| `day` | optional |
| `onlyPlayer` | optional |

---

## Write — army

### `move_army`
| Arg | Required |
|---|---|
| `armyId` | yes |
| `x`, `y` | yes — from tools |
| `append` | optional queue |
| `confirm` | **true** |

### `move_armies`
Same target for many ids (`armyIds[]` or `armyId`).

### `attack_army`
| Arg | Required |
|---|---|
| `armyId` | yes |
| `targetArmyId` | yes |
| `confirm` | **true** |

Melee and bombard share this path (client decides by range).

### `delay_army`
| Arg | Required |
|---|---|
| `armyId` | yes |
| `minutes` | yes (UI minutes) |
| `syncArrival` | optional |
| `confirm` | **true** |

### `set_forced_march` / `set_aggression`
| Arg | Notes |
|---|---|
| `armyId` | required |
| `enabled` / `level` | forced march bool; aggression 1–5 (0 default) |
| `confirm` | **true** |

---

## Write — heroes

### `deploy_hero`
| Arg | Required |
|---|---|
| `heroIdOrName` | shortName, name, or itemId |
| `provinceIdOrName` | own province |
| `confirm` | **true** |

Must be in `get_heroes.deployable`. Own province, morale ≥ threshold, not under attack/mobilizing (client rules).

---

## Write — economy

### `construct_building` / `enqueue_build`
`provinceIdOrName`, `upgradeId`, `confirm`.

### `produce_unit`
`provinceIdOrName`, `unitTypeId`, `confirm`.

### `cancel_building` / `cancel_unit_production`
`provinceIdOrName`, optional `slot`, `confirm`.

### `place_market_order`
`side` (`buy`|`sell`), `resourceId`, `amount`, `limit`, `confirm`.

### `accept_market_order` / `cancel_market_order`
`orderId`, (`amount` for accept), `confirm`.

---

## Write — diplomacy / news

### `send_message`
`text` + `playerIdOrName` (or `playerId` / `name`), `confirm`.

### `set_relation`
`relation` int + player. Typical: `-2` war … `3` right of way … `6` shared intel … `7` military authority. **`confirm`.**

### `create_trade_offer`
`offer` / `ask` maps (resourceId→amount; `15`=province; `17`=relation), `confirm`.

### `respond_trade_offer`
`tradeId` / `tradeOfferId`, `action`: `accept`|`refuse`|`delete`|`read`, `confirm`.

### `write_news`
`title`, `body`, optional `anonymous`, `confirm`.

---

## Map screenshot (read)

### `map_screenshot`
Pan/zoom the live Ultimate map and return a **short-lived public PNG URL** (default TTL 15 min). No Bearer on the image GET — security is unguessable id + expiry.

| Arg | Notes |
|---|---|
| `x`, `y` | Map coords (army `pos` / province capital) |
| `provinceIdOrName` | Focus that province capital |
| `armyId` | Focus that army |
| `zoom` | `far` \| `mid` \| `near` |
| `label` | Caption stored with the shot |
| `waitMs` | Settle after pan (default 800) |

Returns `url`, `expiresAt`, `markdown` (`![map](url)`). Requires map ready (`ensure_ready` with gameId).

---

## Write — buildings on/off

### `set_building_enabled`
Enable/disable a **finished** building in one province (UI AKTIVIEREN / DEAKTIVIEREN). Saves daily upkeep when disabled.

| Arg | Required |
|---|---|
| `provinceIdOrName` | yes |
| `upgradeId` or `upgradeName` | one of (e.g. `21` / `"Recruiting Office"`) |
| `enabled` | yes |
| `confirm` | yes |

### `bulk_set_building_enabled`
Same building type across many provinces (or all own provinces that already have it).

| Arg | Required |
|---|---|
| `upgradeId` or `upgradeName` | one of |
| `enabled` | yes |
| `provinceIds` | no (omit = all own with that building) |
| `confirm` | yes |

---

## Province / orders / history

### `inspect_province`
`provinceIdOrName` or `x`+`y`. Neighbours are real adjacency when the client exposes it; otherwise the nearest capitals (marked approximate).

### `stop_army` / `split_army`
Writes. `stop_army` clears the command queue when the client exposes a stop/clear method. `split_army` peels `{ name|typeId, count }`. If the live client has no matching method, the tool returns the discovered method names instead of pretending success.

### `preview_army_order`
Read-only. `mode` is `move` or `attack`. Sets the drag target and reads `isValidCommand` without `sendAction`.

### `campaign_snapshot` / `campaign_diff` / `campaign_history`
Stored under `/data/history/{gameId}`. Autosnap every `S1914_HISTORY_MS` (default 8 min) only when the queue is idle. `0` disables autosnap.

## Not implemented (do not invent)

- Explicit merge (use move-to-same-tile)
- Patrol helper
- Coalition admin beyond messaging
- `map_screenshot` (disabled; Xvfb capture hangs)  
