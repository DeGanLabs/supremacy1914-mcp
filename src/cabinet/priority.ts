/** Conflict resolution: highest priority wins. */

export type PriorityTier =
  | "EMERGENCY"
  | "SURVIVAL"
  | "WAR"
  | "DEFENSE"
  | "STRATEGIC_ECONOMY"
  | "PROFIT"
  | "OPTIMIZATION";

export const PRIORITY_RANK: Record<PriorityTier, number> = {
  EMERGENCY: 0,
  SURVIVAL: 10,
  WAR: 20,
  DEFENSE: 30,
  STRATEGIC_ECONOMY: 40,
  PROFIT: 50,
  OPTIMIZATION: 60,
};

export type HumanMode = "AUTO" | "SUGGEST" | "CONFIRM" | "PAUSE" | "ABORT";

export function modeFromAutoPilot(autoPilot: boolean | undefined): HumanMode {
  return autoPilot ? "AUTO" : "CONFIRM";
}

/** High-impact actions always need Confirm unless already reserved/approved under AUTO. */
export function isHighImpact(action: string, risk?: string): boolean {
  if (risk === "high") return true;
  return /declare.?war|dump.?reserve|sell.?all|hero.?danger|strategic.?fleet|attack.?large|major.?diplo|embargo.?retaliation/i.test(
    action,
  );
}

export function mayAutoExecute(opts: {
  mode: HumanMode;
  action: string;
  risk?: string;
  emergencyStop?: boolean;
  paused?: boolean;
}): boolean {
  if (opts.emergencyStop || opts.paused || opts.mode === "PAUSE") return false;
  if (opts.mode === "ABORT" || opts.mode === "SUGGEST") return false;
  if (opts.mode === "CONFIRM") return false;
  if (opts.mode === "AUTO") {
    if (isHighImpact(opts.action, opts.risk)) return false;
    return true;
  }
  return false;
}

/** Finance cannot sell if War reserved the resource at higher priority. */
export function financeMayTrade(opts: {
  warReserved: boolean;
  survivalShortage: boolean;
  tier?: PriorityTier;
}): boolean {
  if (opts.survivalShortage) return false;
  if (opts.warReserved) return false;
  const tier = opts.tier ?? "PROFIT";
  return PRIORITY_RANK[tier] >= PRIORITY_RANK.PROFIT;
}

export function compareTier(a: PriorityTier, b: PriorityTier): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}
