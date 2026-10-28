# Supremacy 1914 — tips & rules for agents

Practical rules for playing **through this MCP**. Aligns with how the Ultimate client behaves; not a substitute for official patch notes.

---

## Map & fog of war

- You only know armies/details the client knows (`detailsVisible`, shared map, spies).
- Province **owner** is usually known for the whole map; **composition** of enemies often is not.
- `get_world_summary` = counts. `get_war_picture` = tactical slice. `get_finance_picture` = **your** economy geography.
- Never invent theaters or enemy stacks that aren’t in tool output.

---

## Coordinates

- Game map uses **Cartesian** `x,y` (hundreds–thousands), not GPS.
- Land moves: target **province capital** coords from finance, or an army `pos`.
- Sea / ships: only water or coast. Inland capitals reject or path-fail.
- After a move, trust `destinationProvince` / `verified` in the result when present.

---

## Armies & combat

- Every stack (infantry, mixed, **deployed hero**) is an `UltArmy` with an `armyId`.
- **Concentrate** the main hammer. Don’t split a large stack into three weak probes without a reason.
- Kill the **main** enemy army; ignore 1–5 scraps while a 20+ stack lives.
- **Attack** and **bombard** use the same action path; range decides bombard vs melee.
- **Forced march** burns morale/resources for speed — use deliberately.
- **Aggression** levels ~1–5 (return fire → fully aggressive); `0` = unit default.
- Group arrival: multiple `move_army` to the **same capital**, not `delay_army` as a meeting trick.

### Coastal / naval (short doctrine)

1. Ships = ranged fire + sea control, not floating infantry.  
2. Coastal fight: **bombard first, land second** unless ground odds already crush.  
3. Don’t send one valuable ship alone into contested water.  
4. Embarked transports are priority kills.  
5. Fortress heavily reduces bombardment (roughly L1 ~30% … L5 ~90% reduction — treat as soft fire over time, not instant delete).  
6. Stay near **max bombard range** that still hits; don’t park on the enemy stack.  

---

## Heroes / generals

- Heroes live in **inventory**; deploy with `deploy_hero` onto an **own** province.
- **Day gate:** many heroes unlock on scenario day N (`dayOfAvailability`). Day 1 ≠ all heroes.
- Always use `get_heroes.deployable` (includes `dayReached`).
- Caps: `deployedCount` / `maxDeployed` (e.g. 5/5).
- Morale threshold (often ~70), not under attack / mobilizing — client enforces.
- After deploy, the hero is a normal army — **gather troops by moving stacks onto him**.
- Keep named generals with their assigned stacks; don’t strip them silently.

---

## Economy

- Resources: grain, fish, iron, lumber, coal, oil, gas, **money**, etc.
- Watch **rates** (negative grain with high consumption = starvation risk).
- Build with `list_province_upgrades` → `construct_building` / `enqueue_build`.
- Market: `get_market` then place/accept/cancel orders carefully (prices matter).
- Don’t dump all money into builds while an invasion is active unless asked.

---

## Diplomacy (relation ints)

Approximate client levels:

| Value | Typical meaning |
|---|---|
| -2 | War |
| -1 | Ceasefire |
| 0 | Trade embargo |
| 1 | Peace |
| 2 | Non-aggression |
| 3 | Right of way (RoW) |
| 4 | View military actions / share map tier |
| 5 | Mutual protection |
| 6 | Shared intelligence |
| 7 | Military authority |

- **RoW alone is not a trusted border.** Don’t march through without checking.
- Public newspaper: no army ids, exact ETAs, or attack axes.

Trade bag special keys: `15` = province, `17` = relation (plus normal resource ids).

---

## Morale & provinces

- Low morale → revolt risk / poor fighting. Heroes often need morale ≥ threshold to deploy.
- Capitals (building) and forts change defense and bombard effectiveness.
- Own province ids for actions: prefer `get_finance_picture` / own-province lookup (correct `locationID`).

---

## Agent playstyle checklist

- [ ] Read war picture before moving  
- [ ] Coords from tools only  
- [ ] Heroes from `deployable` only  
- [ ] Concentrate force; name the main target  
- [ ] Confirm destructive diplo / war with the human  
- [ ] Writes only with `confirm: true`  

---

## Sources in this repo

- MCP tools: [TOOLS.md](TOOLS.md)  
- Recipes: [WORKFLOWS.md](WORKFLOWS.md)  
- Broader cabinet doctrine (optional): `src/cabinet/prompts/war.md`, `src/cabinet/prompts/doctrine/naval-coastal.md`  
