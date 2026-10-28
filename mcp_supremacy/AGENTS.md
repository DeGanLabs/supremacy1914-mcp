# MCP agent guide — Supremacy 1914 (`mcp-supremacy`)

You control **one player account** through live browser tools. You are not omniscient: you see what the Ultimate client sees (fog of war).

Read also:
- [docs/TOOLS.md](docs/TOOLS.md) — every tool + parameters  
- [docs/WORKFLOWS.md](docs/WORKFLOWS.md) — copy-paste recipes  
- [docs/GAMEPLAY.md](docs/GAMEPLAY.md) — rules, tips, doctrine  
- [docs/DEPLOY.md](docs/DEPLOY.md) — self-host Docker + optional tunnel

---

## Hard rules

1. **Always start with** `ensure_ready` `{ "gameId": <id> }` (or `health` then `open_game`).
2. **Never invent map coordinates.** Use capitals / army `pos` from tools. Map coords look like `{ x: 1639, y: 675 }` — **not** Earth lat/long.
3. **Writes** need env `S1914_MCP_WRITES=1` **and** `"confirm": true` on the tool call.
4. **Only act on your armies / provinces.** Foreign stacks are visible only within FoW.
5. Prefer **read → plan → confirm write**. Don’t spam moves.
6. Heroes: only deploy if `canDeploy: true` (includes **scenario day gate**). Check `get_heroes` → `deployable`.
7. Sea units: destinations must be **water/coast**, never inland province capitals.
8. If a tool fails with “map not ready”, call `ensure_ready` again and retry once.

---

## First 60 seconds

```text
1. ensure_ready { gameId }
2. current_game / health
3. get_war_picture  OR  get_own_armies + get_relations
4. get_finance_picture + get_resources   (if economy matters)
5. Optional: map_screenshot { provinceIdOrName | armyId | x,y } → share expiring PNG link
6. Then propose actions; wait for user OK before confirms if unsure
```

List maps anytime: `list_games` → switch with `use_game` / `open_game`.

**Economy tip:** disable expensive buildings (`set_building_enabled` / `bulk_set_building_enabled`, e.g. Recruiting Office `upgradeId: 21`) when grain/money is tight; re-enable later. Always `confirm: true`.

---

## Coordinates & “capital”

| Term | Meaning | How to get |
|---|---|---|
| Province capital | Map point of that province | `get_finance_picture` → `provinces[].capital` |
| Capital **building** | Upgrade “Capital” on one home province | finance `buildings` where name/id is Capital |
| Army position | Live stack `pos` | `get_own_armies` |

Moving “to capital X” means that province’s **`capital.x/y`**, unless the user names the Capital building province.

---

## Gathering a general + troops

There is **no merge API**. Stacking = move armies onto the same tile:

1. `deploy_hero` to a province (`confirm: true`)  
2. `get_own_armies` → find hero `armyId` + `pos`  
3. `move_army` other stacks to that `pos` / province capital  

See [WORKFLOWS.md](docs/WORKFLOWS.md#gather-general--troops).

---

## Safety / etiquette

- Default writes **off** until the human enables them.  
- Don’t declare war / set hostile relations unless asked.  
- Newspaper / diplo text: no leaking exact army ids or attack schedules in public articles.  
- Respect game ToS / fair play.  

---

## When stuck

| Symptom | Fix |
|---|---|
| `hup not ready` | `ensure_ready` / `login` / wait for map |
| `mapState not ready` | retry `ensure_ready` after a few seconds |
| `hero not deployable` | check `dayReached`, cooldown, limit in `get_heroes` |
| Move rejected | land army → land capital; sea → water; don’t invent coords |
| Wrong province | use id from finance (`locationID`), not guessed names |
