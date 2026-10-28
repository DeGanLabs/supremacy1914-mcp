import {
  DEFAULT_MARKET_CONFIG,
  evaluateTradeOpportunity,
  type FinanceState,
  type MarketConfig,
  type ResourceSlice,
} from "./finance-model.js";

export type MarketSignal =
  | "BUY_LOW"
  | "SELL_HIGH"
  | "ARBITRAGE"
  | "STOCKPILE"
  | "PANIC_BUY"
  | "SHORTAGE_WARNING";

export interface MarketOpportunity {
  resource: string;
  signal: MarketSignal;
  net_margin: number;
  net_margin_rate: number;
  reason: string;
  autoEligible: boolean;
}

/** Score tradable opportunities from the rolling finance model. */
export function scanMarketOpportunities(
  state: FinanceState,
  config: MarketConfig = state.config ?? DEFAULT_MARKET_CONFIG,
): MarketOpportunity[] {
  const out: MarketOpportunity[] = [];
  const warReserved = state.warOperations.length > 0;
  for (const r of state.resources) {
    const signal = (r.trade_opportunity as MarketSignal | null) ?? null;
    if (!signal) continue;
    const buy = r.market_buy_price;
    const sell = r.market_sell_price;
    if (buy == null || sell == null) {
      if (signal === "SHORTAGE_WARNING" || signal === "PANIC_BUY") {
        out.push({
          resource: r.name,
          signal,
          net_margin: 0,
          net_margin_rate: 0,
          reason: `${signal}: forecast/reserves tight`,
          autoEligible: false,
        });
      }
      continue;
    }
    const ev = evaluateTradeOpportunity({
      buyPrice: buy,
      sellPrice: sell,
      config,
      tradable: r.tradable,
      reserve_target: r.reserve_target,
      warReserved:
        warReserved &&
        state.warOperations.some((op) =>
          Object.keys(op.requirements).some(
            (k) => k.toLowerCase() === r.name.toLowerCase(),
          ),
        ),
      survivalShortage:
        (r.hours_to_empty != null && r.hours_to_empty < 6) ||
        r.forecast_6h < 0,
    });
    out.push({
      resource: r.name,
      signal,
      net_margin: ev.net_margin,
      net_margin_rate: ev.net_margin_rate,
      reason: ev.reason,
      autoEligible: ev.ok && signal !== "PANIC_BUY",
    });
  }
  return out.sort((a, b) => b.net_margin_rate - a.net_margin_rate);
}

export function formatMarketDigest(
  state: FinanceState,
  limit = 2,
): string {
  const ops = scanMarketOpportunities(state);
  const lines = [`Market @ ${state.updatedAt}`];
  const short = state.resources
    .filter(
      (r) =>
        r.trade_opportunity === "SHORTAGE_WARNING" ||
        r.trade_opportunity === "PANIC_BUY" ||
        (r.hours_to_empty != null && r.hours_to_empty < 24),
    )
    .slice(0, 4);
  for (const r of short) {
    lines.push(
      `⚠ ${r.name}: ${Math.round(r.current_stock)} stock · ${r.hours_to_empty != null ? `~${r.hours_to_empty.toFixed(0)}h empty` : "tight"}`,
    );
  }
  if (state.embargoes.length) {
    const e = state.embargoes[state.embargoes.length - 1]!;
    lines.push(`Embargo: ${e.nation ?? e.playerId ?? "?"} (${e.note ?? "noted"})`);
  }
  const top = ops.filter((o) => o.autoEligible || o.signal === "ARBITRAGE").slice(0, limit);
  for (const o of top) {
    lines.push(
      `${o.signal} ${o.resource}: net ${(o.net_margin_rate * 100).toFixed(1)}% — ${o.reason}`,
    );
  }
  if (lines.length === 1) lines.push("No hot shortages or margin trades.");
  return lines.join("\n");
}

export function summarizeSlice(r: ResourceSlice): string {
  return `${r.name}: ${Math.round(r.current_stock)} (tradable ${Math.round(r.tradable)}) net/h ${r.net_per_hour.toFixed(1)}`;
}
