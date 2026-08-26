import type { BuildingSlot } from "./types.js";

function buildingLevel(name: string | null): number {
  if (!name) return 0;
  const m = name.match(/(\d+)\s*$/) || name.match(/L(?:evel)?\s*(\d+)/i);
  return m ? Number(m[1]) : /barrack|factory|workshop|rail|harbour|harbor|fort|airfield|recruit/i.test(name)
    ? 1
    : 0;
}

export function hasBuilding(
  buildings: readonly BuildingSlot[],
  re: RegExp,
): { hit: boolean; level: number; name: string | null } {
  let best = { hit: false, level: 0, name: null as string | null };
  for (const b of buildings) {
    const n = b.name ?? "";
    if (!re.test(n)) continue;
    const level = buildingLevel(n);
    if (level >= best.level) best = { hit: true, level, name: n };
  }
  return best;
}

/** Heuristic 0–100: useful buildings vs province potential (resource + morale). */
export function computeEfficiency(input: {
  resourceType: string | null;
  isDouble: boolean;
  morale: number | null;
  mainProduction: number | null;
  buildings: readonly BuildingSlot[];
}): number {
  const morale = input.morale ?? 70;
  const workshop = hasBuilding(input.buildings, /workshop/i);
  const factory = hasBuilding(input.buildings, /factory/i);
  const rail = hasBuilding(input.buildings, /rail/i);
  const barracks = hasBuilding(input.buildings, /barrack/i);
  const harbour = hasBuilding(input.buildings, /harbour|harbor|port/i);

  let potential = 40;
  if (input.isDouble) potential += 25;
  else if (input.resourceType) potential += 15;
  if ((input.mainProduction ?? 0) > 0) potential += 10;
  potential = Math.min(100, potential);

  let useful = morale * 0.35;
  useful += workshop.level * 8;
  useful += factory.level * 12;
  useful += rail.level * 6;
  if (harbour.hit) useful += 5;
  // Barracks help war but hurt eco efficiency slightly when overbuilt
  useful += Math.min(6, barracks.level * 2);
  useful = Math.min(100, useful);

  const ratio = potential <= 0 ? 50 : (useful / potential) * 100;
  return Math.max(0, Math.min(100, Math.round(ratio)));
}

export function computeInfraScore(buildings: readonly BuildingSlot[]): number {
  let s = 0;
  for (const b of buildings) {
    const n = b.name ?? "";
    if (/factory/i.test(n)) s += 18;
    else if (/workshop/i.test(n)) s += 12;
    else if (/rail/i.test(n)) s += 10;
    else if (/harbour|harbor|airfield|fort/i.test(n)) s += 8;
    else if (/barrack|recruit/i.test(n)) s += 5;
    else if (n) s += 3;
  }
  return Math.min(100, s);
}

/** Crude invested $ proxy from building names/levels. */
export function estimateInvested(buildings: readonly BuildingSlot[]): number {
  let $ = 0;
  for (const b of buildings) {
    const n = b.name ?? "";
    const lvl = buildingLevel(n) || 1;
    if (/factory/i.test(n)) $ += 4000 * lvl;
    else if (/workshop/i.test(n)) $ += 2000 * lvl;
    else if (/rail/i.test(n)) $ += 2500 * lvl;
    else if (/barrack/i.test(n)) $ += 1500 * lvl;
    else if (/harbour|harbor|airfield|fort/i.test(n)) $ += 3000 * lvl;
    else if (n) $ += 800 * lvl;
  }
  return $;
}

/**
 * Capital wasted: high investment but low efficiency / low morale utilization.
 * Distinct from RICH_IDLE (no industry on rich tile).
 */
export function isCapitalWasted(input: {
  invested: number;
  efficiencyScore: number;
  morale: number | null;
  mainProduction: number | null;
}): { wasted: boolean; utilizationPct: number } {
  const outputProxy = Math.max(0, (input.mainProduction ?? 0) * 20) + input.efficiencyScore * 50;
  const util =
    input.invested <= 0
      ? 100
      : Math.min(100, Math.round((outputProxy / Math.max(input.invested, 1)) * 100));
  const wasted =
    input.invested >= 8000 &&
    (input.efficiencyScore < 50 || (input.morale != null && input.morale < 55) || util < 45);
  return { wasted, utilizationPct: util };
}

export function provinceRole(
  resourceType: string | null,
  isDouble: boolean,
  buildings: readonly BuildingSlot[],
): string {
  const factory = hasBuilding(buildings, /factory/i);
  const barracks = hasBuilding(buildings, /barrack/i);
  const rt = (resourceType || "mixed").toUpperCase();
  if (factory.hit && isDouble) return `${rt} CORE`;
  if (factory.hit) return `${rt} INDUSTRY`;
  if (barracks.hit) return `${rt} MANPOWER`;
  if (isDouble) return `${rt} DOUBLE`;
  return `${rt} PROVINCE`;
}
