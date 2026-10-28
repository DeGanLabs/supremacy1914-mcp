import type { CabinetMemory } from "./memory.js";

export type HeroTaskStatus = "queued" | "active" | "done" | "failed";

export interface HeroTask {
  readonly id: string;
  readonly heroArmyId: number;
  readonly heroName?: string;
  readonly goal: "invade" | "hold" | "withdraw";
  readonly province?: string;
  readonly attachedArmyIds: number[];
  readonly status: HeroTaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly note?: string;
}

function taskId(): string {
  return `ht_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function loadHeroTasks(
  memory: CabinetMemory,
): Promise<HeroTask[]> {
  return (await memory.loadHeroTasks()) ?? [];
}

export async function saveHeroTasks(
  memory: CabinetMemory,
  tasks: HeroTask[],
): Promise<void> {
  await memory.saveHeroTasks(tasks);
}

export async function addHeroTask(
  memory: CabinetMemory,
  input: {
    heroArmyId: number;
    heroName?: string;
    goal: HeroTask["goal"];
    province?: string;
    attachedArmyIds?: number[];
    note?: string;
  },
): Promise<HeroTask> {
  const tasks = await loadHeroTasks(memory);
  const next: HeroTask = {
    id: taskId(),
    heroArmyId: input.heroArmyId,
    heroName: input.heroName,
    goal: input.goal,
    province: input.province,
    attachedArmyIds: input.attachedArmyIds ?? [],
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    note: input.note,
  };
  tasks.push(next);
  await saveHeroTasks(memory, tasks);
  return next;
}

export async function updateHeroTask(
  memory: CabinetMemory,
  id: string,
  patch: Partial<HeroTask>,
): Promise<HeroTask | null> {
  const tasks = await loadHeroTasks(memory);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const cur = tasks[idx]!;
  const next = {
    ...cur,
    ...patch,
    id: cur.id,
    updatedAt: new Date().toISOString(),
  } as HeroTask;
  tasks[idx] = next;
  await saveHeroTasks(memory, tasks);
  return next;
}

export function rankHeroes(
  deployed: ReadonlyArray<{
    armyId: number;
    province?: string | null;
    heroes?: Array<{ name?: string; shortName?: string; level?: number; rarity?: string }>;
    units?: Array<{ name?: string; size?: number }>;
    morale?: number;
  }>,
): Array<{
  armyId: number;
  province: string;
  heroName: string;
  level: number;
  rarity: string;
  stackSize: number;
  morale: number;
  score: number;
}> {
  const rarityScore: Record<string, number> = {
    legendary: 40,
    epic: 30,
    rare: 20,
    uncommon: 10,
    common: 5,
  };
  const rows = [];
  for (const d of deployed) {
    const h = d.heroes?.[0];
    if (!h) continue;
    const stackSize = (d.units ?? []).reduce(
      (s, u) => s + (Number(u.size) || 0),
      0,
    );
    const level = Number(h.level) || 1;
    const rarity = String(h.rarity ?? "common").toLowerCase();
    const morale = Number(d.morale) || 50;
    const score =
      level * 10 +
      (rarityScore[rarity] ?? 0) +
      stackSize +
      morale * 0.1;
    rows.push({
      armyId: d.armyId,
      province: d.province ?? "?",
      heroName: h.name || h.shortName || "Hero",
      level,
      rarity,
      stackSize,
      morale,
      score,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}
