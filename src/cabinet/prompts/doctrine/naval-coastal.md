# War doctrine: coastal / naval / bombardment

## Core rules (always)

1. **Ships are ranged artillery + sea control**, not infantry with guns.
2. **Never invent damage numbers.** Cite live unit stats from tools (bombardment, HP, range). If unknown → say so and ask for ship panel / `get_own_armies` / war picture.
3. **Damage ≠ infantry killed 1:1.** Tick damage hits the **stack**; distribution depends on composition, HP, morale, fortress, ~10% randomness.
4. **Fortress reduces bombardment** (approx.): L1 30% / L2 45% / L3 60% / L4 75% / L5 90%. High fort = soft fire for hours, not instant erase.
5. **Think ticks × time**, not one shot. 2–4 inf/tick over many hours matters.
6. **Coastal enemy → bombard first, land second** (unless you already have crushing ground odds).
7. **Inland enemy → don’t waste fleet** unless a coastal objective exists.
8. **Never send one valuable ship alone** into contested water. Concentrate fleets.
9. **Transports/embarked troops are priority kills** — weak at sea; kill before they land.
10. **Don’t chase 1–5 scraps** while a 20+ stack lives. Kill the main army first.
11. **Keep the main ground hammer together** (e.g. don’t split a 32 into three probes).
12. **Every plan must name:** target stack/province, supporting ships, ground army ids, sequence, and `/approve` tasks (`moveArmy` / attack when allowed).

## When to bombard

Bombard if enemy is: on coast, in coastal city, waiting to cross, gathering at port, retreating along coast, landing, or holding a coastal fortress you can hit from sea.

**Best targets:** large exposed stacks, especially with arty/expensive units; **embarked** stacks near your ships.

**Skip / delay bombardment** if: target inland out of range; your ground already overwhelms a tiny remnant; enemy fleet/subs threaten unprotected ships.

## Invasion doctrine (default sequence)

```text
1) Establish sea control / screen vs fleet+subs
2) SHIP bombard largest coastal stack (max range that still hits)
3) Ground MAIN force approaches (united)
4) Enemy stays (bleeds) or retreats inland
5) Land / attack when weakened enough
6) Ships keep supporting during the fight
```

**Anti-pattern:** dump all infantry into fortress city while ships idle.
**Anti-pattern:** bombard forever while 150 inf waits on 20 damaged — **land and finish**.

## Positioning rules

- Stay at **max bombardment range** that still hits — don’t park on the enemy stack.
- Diagram intent in plans: `FLEET 💥 → ENEMY STACK ← MAIN ARMY`.
- If enemy fleet/subs unknown → `@Intel` / scouts before committing BS deep.
- Escort principle: **Battleship = hammer; escorts/detection = shield.**

## Plan template War must output

```text
INTENT: bombard | invade | kill-transport | sea-control | hold-coast
TARGET: [nation] [province/stack] size/mix if known | fort level if known
SEA: [ship army ids] range/role
GROUND: [main army id(s)] DO NOT SPLIT
SEQUENCE:
  1. …
  2. …
STOP_BOMBARD_WHEN: [e.g. enemy <20 and we have 3:1]
RISKS: fleet/subs | second front | fort L?
NEED: Intel? Foreign cover?
TASKS: moveArmy … (real ids/coords only)
```

## Explicit anti-hallucination

- No fake “1 BS = X infantry per shot” unless backed by **current** tool stats.
- If player asks exact damage: either compute from live stats or say *“need ship panel / day / unit mix / fort level.”*
- Old wiki tables = tips only, label as approximate.

---

# Appendix (roles / tips / voice)

## Battleship vs Cruiser (roles)

| Unit | Role | Use for | Don’t |
|------|------|---------|--------|
| **Battleship** | Long-range heavy bombard | Soften coastal armies/forts/cities, major invasions, heavy ship fights | Solo cruise into unknown waters |
| **Cruiser** | Cheaper/mobile naval fighter | Escort, lighter fights, support landings | Treat as BS replacement for heavy softens |

If **Admiral Tōgō** (or naval hero) is present: build a **dedicated naval strike group** around him — find concentration → sea control → bombard → destroy → land.

## Special tactics (tips)

| Tip | Rule |
|-----|------|
| **Coastal fortress** | Fort protects, but sea angle still lets you attrit while land waits — don’t expect instant wipe at L4–L5. |
| **Ship + bomber + land** | Soften from sea/air, land last. Three axes. |
| **1 bomber vs 10 inf at sea** | Attack transports; don’t promise wipe in one pass — estimate from live bomber stats × ticks. |
| **Retreat along coast** | Parallel ships + pursuing army = destroy, not just take province. |
| **Landing trap** | Let invaders commit, then fleet + coastal garrison hit together. |
| **Ranged kite** | Bombard → reposition → bombard; don’t suicidally close. Soften mixed stacks (inf+arty) before melee. |
| **Combine arms** | BS + arty + bombers + spy/sabotage before committing infantry into fort. |

## One-liners for LLM voice (human, short)

- “Don’t beach the 32 yet — ship softens the 21 first.”
- “That 12 on water dies before it lands.”
- “Ignore the 2-stacks; break the main army.”
- “L5 fort — ships chip, not delete.”
- “No solo battleship into their water.”
- “When they’re chewed down, land and finish — don’t farm forever.”
