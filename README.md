# s1914-automation

Modular TypeScript skeleton for **Supremacy 1914** automation:

- read armies / resources / diplomacy from the live client (`hup`)
- send signed game actions (move proven) via browser bridge or HTTP POST
- **no hardcoded game IDs, auth hashes, or coordinates** — all parameterized

## Layout

```
src/
  types/          # shared types + wire `@c` action classes
  config/         # env loader
  session/        # AuthProvider (env | browser hup.config.userData)
  transport/      # HttpGameTransport + BrowserBridgeExecutor
  actions/        # UltArmyAction builders + HTTP executor
  state/          # army / resource / diplomacy readers
  services/       # ArmyService / DiplomacyService / ResourceService / GameService
  cabinet/        # AI war cabinet (feat/ai-cabinet) — Telegram + NVIDIA + approve gate
  sensor/         # browser WS bridge protocol + scoped tool gateway
  examples/       # smoke + DevTools console helper (+ connectCabinetBridge)
```

### Branches

| Branch | Purpose |
|--------|---------|
| `main` | Automation skeleton |
| `feat/ai-cabinet` | AI cabinet / Telegram / NVIDIA work (**this feature**) |

## AI war cabinet (Phase 1)

Telegram ministers debate with **scoped** live game data. You approve before any action. Branch: **`feat/ai-cabinet`**.

### Boot order

1. Fill `.env` from `.env.example`: `NVIDIA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_USER_ID` (never commit secrets; rotate if pasted in chat). Optional: `CABINET_BRIDGE_TOKEN` (auto-generated and saved to `data/cabinet/bridge.token` if empty).
2. Open the game tab → paste [`src/examples/browser-console.js`](src/examples/browser-console.js). Cabinet prints the exact connect line; run that:
   ```js
   s1914.connectCabinetBridge("ws://127.0.0.1:8765", "<token from npm run cabinet>")
   ```
   Token is also stored in `localStorage.s1914BridgeToken` after a successful connect. `npm run cabinet:keep` / Tampermonkey reuse it.
3. In the repo:
   ```bash
   npm run cabinet
   ```
4. In the Telegram group: `/status`, then `@Finance summarize my economy`. Owner-only sensors: `/spies` `/armies` `/stats` `/eco` `/diplo`.

### Commands

| Command | Who | Effect |
|---------|-----|--------|
| `/status` | owner (default) | bridge / gameId / models / open plans |
| `/brief` | owner | cheap Chief summary |
| `/war` | owner | war board |
| `/spies` `/armies` `/stats` `/eco` | owner | live sensor widgets |
| `/goal set key value` | owner | standing goal (not a hypothesis) |
| `/seat list` | owner | seats + scopes |
| `/seat add id "Name" scopes=…` | owner | add custom seat |
| `/approve` (or reply `approve`) | owner | run allow-listed tasks only |
| `/reject` | owner | mark rejected — **bridge not touched** |
| `@Finance` `@War` `@Defense` `@Foreign` `@Intel` `@all` `@cabinet` | owner | debate / brief |

### Hard rules (Phase 1)

- Execute allow-list: **`moveArmy`**, **`constructBuilding`**, **`attackArmy`**, **`delayArmy`** (via proven browser helpers).
- Owner ACL: only `TELEGRAM_USER_ID` can approve/seat/goal and (by default) sensors. Set `TELEGRAM_OWNER_ONLY_SENSORS=0` to open the group.
- Tool `dataScopes` enforced in code; cost caps: 2 rounds, 4 tools/seat, 8 auto-executes/hour.
- Bridge down → bot says “game not connected” (no invented stats).
- Current open tab only. Heartbeat `gameId` mismatch drops the lock (reconnect).
- Game dumps are wrapped as untrusted data in LLM prompts. `exportSession()` redacts auth unless `{secrets:true}`.

## Step 1 — Get your keys (`userAuth` + `tstamp`)

Game actions are signed with **`userAuth`** and **`tstamp`**, not with website cookies.
Get them from the live client:

1. Open the game in the browser while logged in  
   (`https://www.supremacy1914.com/game.php…` or `.de`).
2. Open DevTools → **Console** on the **parent** page (the `game.php` tab),  
   **not** inside the game iframe.
3. Paste the entire file [`src/examples/browser-console.js`](src/examples/browser-console.js) and press Enter.  
   You should see: `s1914 ready: …` (a trailing `undefined` is normal).
4. Run:
   ```js
   s1914.exportSession({secrets:true})
   ```
5. You get an object like:
   ```js
   {
     gameServerUri: "https://….bytro.com:443",
     client: "s1914-client-ultimate",
     version: "293",
     gameID: 10880494,
     playerID: 152,
     siteUserID: 67439527,
     userAuth: "<40-char hex>",
     tstamp: "<unix seconds string>",
     rights: "chat",
     adminLevel: 0
   }
   ```
6. Copy into `.env` (from `.env.example`):

   | `exportSession()` field | `.env` key |
   |---|---|
   | `userAuth` | `S1914_USER_AUTH` |
   | `tstamp` | `S1914_TSTAMP` |
   | `gameID` | `S1914_GAME_ID` |
   | `playerID` | `S1914_PLAYER_ID` |
   | `siteUserID` | `S1914_SITE_USER_ID` |
   | `gameServerUri` | `S1914_GAME_SERVER_URI` |
   | `client` | `S1914_CLIENT` |
   | `version` | `S1914_CLIENT_VERSION` |
   | `rights` | `S1914_RIGHTS` |
   | `adminLevel` | `S1914_ADMIN_LEVEL` |

Helpers:

```js
copy(s1914.exportSession({secrets:true}))           // whole object → clipboard
copy(s1914.exportSession({secrets:true}).userAuth)  // auth only
```

**Notes**
- Re-run `exportSession({secrets:true})` after logout, long idle, or when HTTP auth starts failing — keys go stale.
- Browser helpers (`s1914.moveArmy`, …) do **not** need `.env`; they use live `hup` while the tab is open.
- Optional `S1914_COOKIE=bl_sid=…` only if HTTP POSTs fail without a site session. Prefer keys above.
- **Never commit** `.env` or paste real `userAuth` / `bl_sid` into git or public chats.

## Step 2 — List joined maps & choose which to control

One browser tab loads **one** game at a time. List everything you joined, then switch by **index**:

```js
// after pasting browser-console.js
await s1914.listGames()
// → { games: [ { index:0, gameId, title, playerId, day, isCurrent, … }, … ] }

s1914.currentGame()           // what’s loaded now
s1914.useGame(0)              // switch by index from listGames()
s1914.useGame(10880494)       // or by gameId

// after the map finishes loading:
s1914.rebind()                // refresh hup handle
s1914.exportSession({secrets:true})         // NEW userAuth/tstamp/playerID for that map
```

Live example from your account:

| index | gameId | title | your playerId |
|---|---|---|---|
| 0 | 10871961 | The Great War | 43 |
| 1 | 10880494 | [Speed] - World in flames | 152 |

API under the hood: `hup.hupwebapi.getMyGames(siteUserId)` → website `getGames`.
Switch: `hup.gameController.startLoadingTheGame(gameId)`.

```ts
import { fetchMyGamesFromHup, loadGameInHup } from "s1914-automation";
const my = await fetchMyGamesFromHup(hup);
loadGameInHup(hup, my.games[0].gameId);
```

**Note:** `playerID` and `userAuth` are **per game**. After `useGame`, always `rebind()` + `exportSession({secrets:true})` before HTTP `.env` use.

## Auth model (from live client)

Every action POST body is signed like the Ultimate client `signMessage`:

| Field | Source |
|---|---|
| `siteUserID`, `playerID`, `gameID` | `hup.config.userData` |
| `userAuth`, `tstamp` | `hup.config.userData` (via `exportSession()`) |
| `version`, `client` | client build |
| `rights`, `adminLevel` | userData |
| URL | `hup.userActionController.server.serverUri` |

## Quick start

```bash
npm install
cp .env.example .env
# fill .env using Step 1 above (s1914.exportSession({secrets:true}))
npm run smoke
npm run typecheck
```

### Browser (recommended for moves)

Paste `src/examples/browser-console.js` into the **parent** page console:

```js
s1914.dumpOwnArmies()
s1914.dumpResources()
s1914.moveArmy(ARMY_ID, x, y)
s1914.exportSession({secrets:true})  // copy into .env
```

Moves use live A* via `armyController.setDragTarget` → `sendAction()` (same path as the UI).

### HTTP mode

Builds `UltUpdateGameStateAction` → nested `UltArmyAction` and POSTs JSON to the game server URI.

You must supply:

1. `PathProvider` — goto segments (do **not** invent paths; use browser A* or a real pathfinder)
2. `ArmyWireContextProvider` — owner + unit type/size for the wire army payload

## Example (TypeScript)

```ts
import {
  createS1914Client,
  readGameSnapshotFromHup,
  defaultBrowserHupAccessor,
} from "s1914-automation";

const hup = defaultBrowserHupAccessor();

const client = createS1914Client({
  mode: "browser",
  hupAccessor: () => hup,
  readSnapshot: () => readGameSnapshotFromHup(hup as never),
});

const snap = await client.game.snapshot();
await client.game.armies.move({
  armyId: snap.armies[0].id,
  target: { x: 1000, y: 500 },
});
```

## Messages / communications

```ts
import {
  readCommunicationsFromHup,
  readThreadWithPlayer,
  readTradesWithPlayer,
  MessageService,
} from "s1914-automation";

const snap = readCommunicationsFromHup(hup);
// snap.messages, snap.threads, snap.allianceMessages
// snap.openTrades, snap.pastTrades, snap.unread

const related = await messages.relatedWith(15); // FreneSy player id
```

Browser console helper (`src/examples/browser-console.js`):

```js
s1914.dumpAllMessages()
s1914.dumpRelatedByName('FreneSy117')
s1914.dumpRelatedWith(15)
```

## Stats / game states

All live states hang off `hup.gameState`:

| Data | Accessor |
|---|---|
| Combat stats | `getPlayerStatisticsState()` |
| Ranking | players → `getRankingOrder()` |
| Clock / scenario | `getGameInfoState()` |
| Provinces | `getMapState().getPlayerProvinces(id)` |
| Alliance | `getInGameAllianceState().getAlliance()` |
| Spies | `getSpyState()` |
| Events | `getGameEventState().getEvents()` |
| State IDs | `getStatesList()` |

```ts
import { readFullStatsFromHup } from "s1914-automation";
const stats = readFullStatsFromHup(hup);
```

```js
s1914.dumpAllStats()
```

```
UltUpdateGameStateAction
  └─ actions[]
       ├─ UltArmyAction
       │    └─ armies[] (@c:"a")
       │         ├─ id, o (owner), u[] (@c:"u" t/s)
       │         ├─ ag (aggressiveness 0–5), fm (forced march 0|1)
       │         └─ c[] commands:
       │              @c:"gc"  goto sp/tp
       │              @c:"ac"  attack {targetUnitID, targetPos}  ← melee + bombard
       │              @c:"wc"  wait (embark/disembark/special)
       │              @c:"dwc" delay wait (UI Delay)
       │              @c:"pc"  patrol (aircraft)
       ├─ UltUpdateProvinceAction  (build / produce / cancel)
       │    ├─ mode: 1=UPGRADE, 2=SPECIAL_UNIT, 3=CANCEL_PRODUCING, 4=CANCEL_BUILDING
       │    ├─ provinceIDs[]
       │    └─ upgrade: mu (building) | su (unit {u t/s})
       └─ UltBuildQueueAction
            ├─ operation: 0=ADD, 1=REM, 2=MOV, 3=REM_ALL
            └─ entries[] (@c:"be" provinceID + upgrade)
```

## Attack / bombard / delay / speed (armies, infantry, heroes)

Infantry, mixed stacks, and **deployed heroes/generals are all `UltArmy`** — same command system.

| UI action | How it works | Wire |
|---|---|---|
| **Attack** | Command mode `Y0.ATTACK=2`; path then terminal attack | `@c:"ac"` `{targetUnitID, targetPos}` |
| **Bombard** | Not a separate action — ranged units (`range` ≫ melee) fight with status `BOMBARDING` | same `@c:"ac"` |
| **Delay** | UI minutes → `floor(60*min/timeScale)` game-seconds | `@c:"dwc"` `{waitSeconds, cancelable:true, direction:8, …}` |
| **Forced march (speed)** | Toggle on selected armies; sends immediately | army flag `fm: 0\|1` |
| **Aggression** | Levels 1–5 (RETURN_FIRE…); 0 = default | army flag `ag` |

Live notes from your game:
- Solo heroes (Vedmid range 350, von Thaden 750) can bombard; Maeve/Lawrence stacks are melee range ~5
- Heroes allow forced march; aggressiveness selectable 1–5 (solo) or 2–5 (with infantry)
- Patrol aircraft use `@c:"pc"` (separate from attack)

```js
s1914.dumpArmyCombat(17011407)

s1914.attackArmy(17011407, 17000235)   // path + attack/bombard
s1914.delayArmy(17011407, 30)          // +30 minutes delay
s1914.setForcedMarch(17011407, true)   // speed boost
s1914.setAggression(17011407, 4)       // more aggressive
```

```ts
import {
  buildSignedArmyAttackAction,
  buildSignedArmyDelayAction,
  buildSignedArmyFlagsAction,
  delayMinutesToGameSeconds,
  ArmyCommandMode,
} from "s1914-automation";
```

Browser bridge `attack()` uses live A* (`setCommandMode(2)` + `setDragTarget(pos, targetArmy)`).

## Build / create (province production)

Wire builders live in `EconomyActionBuilder` / `buildSignedConstructBuildingAction` / `buildSignedProduceUnitAction`.

Browser (paste `examples/browser-console.js`):

```js
s1914.dumpConstructionOptions('San Francisco')   // upgrade ids + wire mu
s1914.dumpProducibleUnits('Little Rock')         // unit type ids + costs
s1914.dumpProvinceSlots('San Francisco')         // active constructions/productions

s1914.constructBuilding('San Francisco', 16)     // Fortress Lvl.1 example
s1914.produceUnit('Little Rock', 28)             // Balloon; queues if slot busy
s1914.enqueueBuild(1809, 16)                     // add building to global queue
s1914.cancelBuilding(1809, 0)
s1914.cancelUnitProduction(1809, 0)
```

```ts
import {
  buildSignedConstructBuildingAction,
  buildSignedProduceUnitAction,
  ProvinceActionMode,
} from "s1914-automation";

buildSignedConstructBuildingAction({
  session,
  provinceIds: [1809],
  upgrade: { id: 16, condition: 13 },
});

buildSignedProduceUnitAction({
  session,
  provinceIds: [155],
  unitTypeId: 28,
  size: 1,
});
```

## Stock market (buy / sell / check offers)

```js
s1914.dumpMarketOffers()              // all tradeable resources
s1914.dumpMarketOffers(1, 10)         // Fish, top 10
s1914.dumpMyOrders()

s1914.placeMarketOrder('buy', 1, 100, 12)   // buy 100 fish @ 12
s1914.placeMarketOrder('sell', 2, 50, 20)   // sell 50 iron @ 20
s1914.acceptMarketOrder(ORDER_ID, 25)       // take 25 from a book order
s1914.cancelMarketOrder(ORDER_ID)
```

```ts
import {
  buildSignedPlaceMarketOrderAction,
  buildSignedAcceptMarketOrderAction,
  readMarketSnapshotFromHup,
} from "s1914-automation";

const book = readMarketSnapshotFromHup(hup);
buildSignedPlaceMarketOrderAction({
  session,
  side: "buy",
  resourceId: 1,
  amount: 100,
  limit: 12,
});
```

Wire: `UltOrderAction` → `order: UltOrder` (`orderID:0` new, or existing id when accepting) + `cancel`.

## Diplomacy / messages / player trades

Relation levels: WAR=-2 … RIGHT_OF_WAY=3 … SHARED_INTELLIGENCE=6 …

```js
s1914.sendDiploMessage(15, 'hello')          // by player id
s1914.sendDiploMessage('FreneSy117', 'hello')
s1914.setRelation(15, 3)                     // Right of Way
s1914.setRelation('British Canada', -2)      // War

// resource trade: give 100 fish, ask 50 money (20)
s1914.createTradeOffer(15, {1: 100}, {20: 50}, 'fair trade')
// relation in trade bag uses key 17; province uses key 15
s1914.createTradeOffer(15, {17: 4}, {15: 229})  // Share Map for a province

s1914.dumpOpenTradeOffers()
s1914.respondTradeOffer(125, 'accept')  // accept|refuse|delete|read
```

```ts
import {
  buildSignedSendMessageAction,
  buildSignedChangeRelationAction,
  buildSignedCreateTradeOfferAction,
  RelationLevel,
  TradeOfferFlag,
} from "s1914-automation";

buildSignedChangeRelationAction({
  session,
  targetPlayerId: 15,
  relation: RelationLevel.RIGHT_OF_WAY,
});
```

## Generals / heroes (inventory + deploy)

Heroes live in the inventory system (`hup.heroSystemManager`), not as a separate army list.

```js
s1914.dumpHeroes()
// → inventory (owned), deployed, deployable, onCooldown, deployedOnMap
// → maxDeployed / deployedCount (e.g. 5/5)

s1914.deployHero('Allenby', 'San Francisco')   // by short/name + province
s1914.deployHero(22286, 1809)                  // itemId + provinceId
```

Deploy rules (client): own province, morale ≥ threshold, not under attack/mobilizing; ships need coast, planes need airfield. Scenario cap applies (`limitReached`).

Wire: `UsePremiumAction` `{ premiumID: heroItemId, amount: 1, provinces: [provinceId] }`.

```ts
import { readHeroesSnapshotFromHup, buildSignedDeployHeroAction } from "s1914-automation";
const heroes = readHeroesSnapshotFromHup(hup);
buildSignedDeployHeroAction({ session, heroItemId: 22286, provinceId: 1809 });
```

## Newspaper (read / write)

News is per game-day on `hup.gameState.getNewspaperState()`.

```js
s1914.dumpNews()                    // current day
s1914.dumpNews(16)                  // specific day (requests load if missing)
s1914.dumpNews(16, { onlyPlayer: true })

s1914.writeNews('Headline', 'Article body text…')
s1914.writeNews('Anon', 'secret', { anonymous: true })
```

Article kinds: `player` (authorID>0), `system_battle` (-2), `system_stats` (-3).

Wire write: `UltNewArticleAction` `{ rawArticle: UltArticle, imageData, imageName }`.

```ts
import {
  readNewspaperSnapshotFromHup,
  buildSignedWriteNewspaperArticleAction,
} from "s1914-automation";

const news = readNewspaperSnapshotFromHup(hup);
buildSignedWriteNewspaperArticleAction({
  session,
  title: "Headline",
  body: "Body text",
});
```

## World map / other countries’ troops (what you can see)

The Ultimate client already keeps **every province owner** and **all armies currently known to your fog-of-war** in memory. That is the same data the map paints.

```js
s1914.dumpWorldView({ summaryOnly: true })   // countries + counts
s1914.dumpWorldView()                        // + full provinces[] + armies[]
s1914.dumpWorldView({ excludeSelf: true })   // others only
s1914.dumpWorldView({ onlyVisible: true })   // getVisibleArmies() subset
s1914.dumpCountryForces('FreneSy117')        // one country
s1914.dumpCountryForces(15)
```

Per army:
- `detailsVisible: true` → unit list known (same as opened stack on map)
- `detailsVisible: false` → fog marker only (position/owner, no composition)
- Shared map / VMA allies usually show full details

Per province: owner, morale, `unknownUpgrades`, `stationaryArmyId`, capital coords.

Spy extras (deeper intel beyond current FoW): `s1914.dumpSpies()`.

```ts
import { readWorldViewFromHup } from "s1914-automation";
const world = readWorldViewFromHup(hup, { excludeSelf: true });
```

## Skeletons left to capture

These throw until you intercept one live payload (same `signMessage` hook we used for moves):

- stop / split / patrol helpers (patrol wire `@c:"pc"` already known)
- coalition admin actions beyond messaging
- hero recall (if separate from army dismiss)
- newspaper article delete

## Safety

- This controls **your** logged-in session only.
- Test moves on idle stacks first.
- Respect the game ToS / fair-play rules.
