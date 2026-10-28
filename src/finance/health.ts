import type { HealthBreakdown, ResourceRow } from "./types.js";

export function hoursToZero(amount: number, rate: number): number | null {
  if (!(rate < 0)) return null;
  if (amount <= 0) return 0;
  return amount / -rate;
}

export function daysToZero(amount: number, rate: number): number | null {
  const h = hoursToZero(amount, rate);
  return h == null ? null : h / 24;
}

export function statusFromHours(
  minHours: number | null,
): "HEALTHY" | "WARNING" | "CRITICAL" {
  if (minHours == null) return "HEALTHY";
  if (minHours <= 6) return "CRITICAL";
  if (minHours <= 24) return "WARNING";
  return "HEALTHY";
}

export function projectStatusAt(
  resources: readonly ResourceRow[],
  hours: number,
): "HEALTHY" | "WARNING" | "CRITICAL" {
  let worst: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
  const rank = { HEALTHY: 0, WARNING: 1, CRITICAL: 2 };
  for (const r of resources) {
    const future = r.amount + r.rate * hours;
    let s: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    if (future <= 0 && r.rate < 0) s = "CRITICAL";
    else if (r.rate < 0) {
      const hLeft = hoursToZero(r.amount, r.rate);
      if (hLeft != null && hLeft - hours <= 6) s = "CRITICAL";
      else if (hLeft != null && hLeft - hours <= 24) s = "WARNING";
    }
    if (rank[s] > rank[worst]) worst = s;
  }
  return worst;
}

/** Deterministic 0–100 health with component contributions (can be negative for risk). */
export function computeHealth(input: {
  resources: readonly ResourceRow[];
  money: number;
  moneyRate: number | null;
  avgInfra: number;
  tradeScore: number;
  criticalCount: number;
  warUncovered: number;
}): HealthBreakdown {
  const positiveRates = input.resources.filter((r) => r.rate > 0).length;
  const diversity = Math.min(24, positiveRates * 4);
  const netPos = input.resources.reduce((s, r) => s + Math.max(0, r.rate), 0);
  const production = Math.min(24, diversity + Math.min(8, netPos / 50));

  const liqStock = Math.min(16, Math.log10(Math.max(1, input.money)) * 4);
  const liqRate =
    input.moneyRate == null
      ? 4
      : input.moneyRate >= 0
        ? 8
        : Math.max(0, 8 + input.moneyRate / 100);
  const liquidity = Math.min(24, liqStock + liqRate);

  const hours = input.resources
    .map((r) => r.hoursToZero)
    .filter((h): h is number => h != null);
  const minH = hours.length ? Math.min(...hours) : 999;
  const reserves = Math.min(20, minH >= 48 ? 20 : minH >= 24 ? 14 : minH >= 6 ? 7 : 2);

  const infrastructure = Math.min(16, (input.avgInfra / 100) * 16);
  const trade = Math.min(12, input.tradeScore);

  const risk =
    -(input.criticalCount * 4) -
    (input.warUncovered > 0 ? 6 : 0) -
    (minH < 6 ? 8 : minH < 24 ? 4 : 0);

  const total = Math.max(
    0,
    Math.min(100, Math.round(production + liquidity + reserves + infrastructure + trade + risk)),
  );

  return {
    production: Math.round(production),
    liquidity: Math.round(liquidity),
    reserves: Math.round(reserves),
    infrastructure: Math.round(infrastructure),
    trade: Math.round(trade),
    risk: Math.round(risk),
    total,
  };
}
