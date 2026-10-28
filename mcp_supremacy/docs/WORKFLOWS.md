# Agent workflows

Call order is always: **session ready → read → write with confirm**.

---

## Open a game

```json
{ "name": "ensure_ready", "arguments": { "gameId": 12345678 } }
```

Or:

```json
{ "name": "list_games", "arguments": {} }
{ "name": "open_game", "arguments": { "gameId": 12345678 } }
```


---

## Situational awareness

```json
{ "name": "get_war_picture", "arguments": {} }
{ "name": "get_own_armies", "arguments": {} }
{ "name": "get_relations", "arguments": {} }
```

Economy:

```json
{ "name": "get_finance_picture", "arguments": {} }
{ "name": "get_resources", "arguments": {} }
{ "name": "get_market", "arguments": {} }
```

Map shot (expiring public link):

```json
{ "name": "map_screenshot", "arguments": { "provinceIdOrName": "Waddan", "zoom": "near", "label": "Waddan front" } }
```

Disable Recruiting Offices to save money (bulk):

```json
{
  "name": "bulk_set_building_enabled",
  "arguments": { "upgradeId": 21, "enabled": false, "confirm": true }
}
```

---

## Move army to a province capital

1. `get_finance_picture` → find province `capital.x/y`  
2. `get_own_armies` → pick `armyId`  
3. Move:

```json
{
  "name": "move_army",
  "arguments": {
    "armyId": 17000168,
    "x": 1639,
    "y": 675,
    "confirm": true
  }
}
```

**Group move:** same `x,y` for several `move_army` / one `move_armies` — do **not** use `delay_army` just to sync.

---

## Gather general + troops

```text
1) get_heroes → pick from deployable[] (dayReached must be true)
2) deploy_hero { heroIdOrName, provinceIdOrName, confirm: true }
3) get_own_armies → locate hero army (units include hero / name)
4) move_army each infantry stack to hero pos or that province capital
```

Example:

```json
{
  "name": "deploy_hero",
  "arguments": {
    "heroIdOrName": "Callahan",
    "provinceIdOrName": "Bridgehead Alpha",
    "confirm": true
  }
}
```

If deploy fails: read error (`dayReached`, cooldown, limit). Never force Allenby on day 1 if unlock day is 2.

---

## Attack / bombard

```json
{
  "name": "attack_army",
  "arguments": {
    "armyId": 17000168,
    "targetArmyId": 17000235,
    "confirm": true
  }
}
```

Same tool for melee and bombard (range decides). Prefer targets from `get_war_picture`.

---

## Build / produce

```json
{
  "name": "list_province_upgrades",
  "arguments": { "provinceIdOrName": "Bridgehead Alpha" }
}
```

```json
{
  "name": "construct_building",
  "arguments": {
    "provinceIdOrName": "Bridgehead Alpha",
    "upgradeId": 16,
    "confirm": true
  }
}
```

Check `get_resources` first so you don’t bankrupt the account.

---

## Diplomacy message

```json
{
  "name": "send_message",
  "arguments": {
    "playerIdOrName": "SomeNation",
    "text": "Proposal: RoW both ways. No war.",
    "confirm": true
  }
}
```

Relation change (dangerous — confirm with human):

```json
{
  "name": "set_relation",
  "arguments": {
    "playerIdOrName": 15,
    "relation": 3,
    "confirm": true
  }
}
```

(`3` ≈ Right of Way; `-2` ≈ War.)

---

## ChatGPT / HTTP agents

Same tool names via:

```http
POST /mcp/call
Authorization: Bearer <S1914_MCP_TOKEN>
Content-Type: application/json

{ "name": "ensure_ready", "arguments": { "gameId": 12345678 } }
```

Then reads/writes as above. See [../README.md](../README.md).
