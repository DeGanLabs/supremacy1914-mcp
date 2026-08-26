import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEventBus } from "./events.js";
import { financeMayTrade } from "./priority.js";

export interface MarketConfig {
  transaction_fee_rate: number;
  minimum_net_margin_rate: number;
  minimum_absolute_profit: number;
  minimum_reserve_hours: number;
}

export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  transaction_fee_rate: 0.02,
  minimum_net_margin_rate: 0.03,
  minimum_absolute_profit: 0,
  minimum_reserve_hours: 12,
};

export interface ResourceSlice {
  name: string;
  current_stock: number;
  production_per_hour: number;
  consumption_per_hour: number;
  net_per_hour: number;
  reserve_target: number;
  operational_reserve: number;
  strategic_reserve: number;
  tradable: number;
  forecast_6h: number;
  forecast_24h: number;
  market_buy_price?: number;
  market_sell_price?: number;
  effective_buy_price?: number;
  effective_sell_price?: number;
  trade_opportunity?: string | null;
  hours_to_empty?: number | null;
}

export interface WarOperationDemand {
  id: string;
  name: string;
  expected_duration_h: number;
  requirements: Record<string, number>;
  createdAt: string;
}

export interface FinanceState {
  updatedAt: string;
  cash?: number;
  resources: ResourceSlice[];
  embargoes: Array<{
    playerId?: number;
    nation?: string;
    t: string;
    note?: string;
  }>;
  warOperations: WarOperationDemand[];
  config: MarketConfig;
}

export async function loadMarketConfig(
  rootDir: string,
): Promise<MarketConfig> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(rootDir, "market-config.json"), "utf8"),
    ) as Partial<MarketConfig>;
    return { ...DEFAULT_MARKET_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_MARKET_CONFIG };
  }
}

export async function loadFinanceState(
  rootDir: string,
): Promise<FinanceState | null> {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, "finance.json"), "utf8"),
    ) as FinanceState;
  } catch {
    return null;
  }
}

export async function saveFinanceState(
  rootDir: string,
  state: FinanceState,
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    path.join(rootDir, "finance.json"),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

/** Build rolling model from get_resources dump (+ optional market rows). */
export function buildResourceModel(
  resourcesRaw: unknown,
  marketRaw: unknown,
  config: MarketConfig,
  prev?: FinanceState | null,
): ResourceSlice[] {
  const fee = config.transaction_fee_rate;
  const marketByName = new Map<
    string,
    { buy?: number; sell?: number }
  >();
  if (Array.isArray(marketRaw)) {
    for (const row of marketRaw) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const name = String(r.resource ?? r.name ?? "").toLowerCase();
      if (!name) continue;
      const price = Number(r.price ?? r.rate);
      const side = String(r.side ?? r.type ?? "").toLowerCase();
      const cur = marketByName.get(name) ?? {};
      if (side.includes("buy") || side.includes("bid")) cur.buy = price;
      else if (side.includes("sell") || side.includes("ask")) cur.sell = price;
      else if (Number.isFinite(price)) cur.sell = price;
      marketByName.set(name, cur);
    }
  }

  const out: ResourceSlice[] = [];
  if (!Array.isArray(resourcesRaw)) return out;

  for (const row of resourcesRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? r.id ?? "?");
    const stock = Number(r.amount);
    if (!Number.isFinite(stock)) continue;
    const rate = Number(r.rate);
    const prod = Number(r.production);
    const cons = Number(r.consumption);
    const net = Number.isFinite(rate)
      ? rate
      : Number.isFinite(prod) && Number.isFinite(cons)
        ? prod - cons
        : 0;
    // Approximate hourly from tick if rates look per-tick; use as-is if large.
    const perHour = Math.abs(net) < 50 ? net * 60 : net;
    const production_per_hour = perHour > 0 ? perHour : 0;
    const consumption_per_hour = perHour < 0 ? -perHour : 0;
    const prevRow = prev?.resources.find(
      (x) => x.name.toLowerCase() === name.toLowerCase(),
    );
    const reserve_target =
      prevRow?.reserve_target ??
      Math.max(stock * 0.25, consumption_per_hour * config.minimum_reserve_hours);
    const operational_reserve =
      prevRow?.operational_reserve ?? Math.min(stock, reserve_target * 0.5);
    const strategic_reserve =
      prevRow?.strategic_reserve ?? Math.min(stock - operational_reserve, reserve_target * 0.25);
    const locked = operational_reserve + strategic_reserve;
    const tradable = Math.max(0, stock - locked);
    const forecast_6h = stock + perHour * 6;
    const forecast_24h = stock + perHour * 24;
    const m = marketByName.get(name.toLowerCase());
    const buy = m?.buy;
    const sell = m?.sell;
    const effective_buy =
      buy != null ? buy * (1 + fee) : undefined;
    const effective_sell =
      sell != null ? sell * (1 - fee) : undefined;
    let trade_opportunity: string | null = null;
    if (
      effective_buy != null &&
      effective_sell != null &&
      effective_sell > effective_buy * (1 + config.minimum_net_margin_rate)
    ) {
      trade_opportunity = "ARBITRAGE";
    } else if (forecast_6h < reserve_target && buy != null) {
      trade_opportunity = "PANIC_BUY";
    } else if (tradable > reserve_target && sell != null) {
      trade_opportunity = "SELL_HIGH";
    } else if (buy != null && forecast_24h < 0) {
      trade_opportunity = "SHORTAGE_WARNING";
    } else if (buy != null && stock < reserve_target) {
      trade_opportunity = "STOCKPILE";
    }

    const hours_to_empty =
      perHour < -0.01 ? stock / -perHour : null;

    out.push({
      name,
      current_stock: stock,
      production_per_hour,
      consumption_per_hour,
      net_per_hour: perHour,
      reserve_target,
      operational_reserve,
      strategic_reserve,
      tradable,
      forecast_6h,
      forecast_24h,
      market_buy_price: buy,
      market_sell_price: sell,
      effective_buy_price: effective_buy,
      effective_sell_price: effective_sell,
      trade_opportunity,
      hours_to_empty,
    });
  }
  return out;
}

export function evaluateTradeOpportunity(opts: {
  buyPrice: number;
  sellPrice: number;
  config: MarketConfig;
  tradable: number;
  reserve_target: number;
  warReserved: boolean;
  survivalShortage: boolean;
}): {
  ok: boolean;
  net_margin: number;
  net_margin_rate: number;
  reason: string;
} {
  const fee = opts.config.transaction_fee_rate;
  const effectiveCost = opts.buyPrice * (1 + fee);
  const effectiveSell = opts.sellPrice * (1 - fee);
  const net = effectiveSell - effectiveCost;
  const rate = effectiveCost > 0 ? net / effectiveCost : 0;
  if (!financeMayTrade({
    warReserved: opts.warReserved,
    survivalShortage: opts.survivalShortage,
  })) {
    return {
      ok: false,
      net_margin: net,
      net_margin_rate: rate,
      reason: "blocked by War/survival reserve priority",
    };
  }
  if (opts.tradable <= 0) {
    return {
      ok: false,
      net_margin: net,
      net_margin_rate: rate,
      reason: "no tradable inventory",
    };
  }
  if (net < opts.config.minimum_absolute_profit) {
    return {
      ok: false,
      net_margin: net,
      net_margin_rate: rate,
      reason: "below absolute profit floor",
    };
  }
  if (rate < opts.config.minimum_net_margin_rate) {
    return {
      ok: false,
      net_margin: net,
      net_margin_rate: rate,
      reason: `net margin ${(rate * 100).toFixed(1)}% < ${(opts.config.minimum_net_margin_rate * 100).toFixed(0)}% (fee is a cost, not the bar)`,
    };
  }
  return {
    ok: true,
    net_margin: net,
    net_margin_rate: rate,
    reason: "meets margin + reserve gates",
  };
}

export function fundWarOperation(
  state: FinanceState,
  op: WarOperationDemand,
): { safe: boolean; gaps: string[] } {
  const gaps: string[] = [];
  for (const [res, need] of Object.entries(op.requirements)) {
    const row = state.resources.find(
      (r) => r.name.toLowerCase() === res.toLowerCase(),
    );
    const available =
      (row?.current_stock ?? 0) +
      (row?.net_per_hour ?? 0) * op.expected_duration_h;
    if (available < need) {
      gaps.push(
        `${res}: need ${need}, forecast ~${Math.round(available)} over ${op.expected_duration_h}h`,
      );
    }
  }
  return { safe: gaps.length === 0, gaps };
}

export async function recordEmbargo(
  rootDir: string,
  embargo: { playerId?: number; nation?: string; note?: string },
): Promise<void> {
  const config = await loadMarketConfig(rootDir);
  const prev = await loadFinanceState(rootDir);
  const state: FinanceState = prev ?? {
    updatedAt: new Date().toISOString(),
    resources: [],
    embargoes: [],
    warOperations: [],
    config,
  };
  state.embargoes.push({
    ...embargo,
    t: new Date().toISOString(),
  });
  while (state.embargoes.length > 40) state.embargoes.shift();
  state.updatedAt = new Date().toISOString();
  await saveFinanceState(rootDir, state);
  await getEventBus(rootDir).publish("TRADE_EMBARGO_DETECTED", {
    source: "finance",
    playerId: embargo.playerId,
    nation: embargo.nation,
    payload: { note: embargo.note },
  });
}

export function formatFinanceBrief(state: FinanceState): string {
  const lines = [`Finance model @ ${state.updatedAt}`];
  const hot = state.resources
    .filter(
      (r) =>
        r.trade_opportunity ||
        (r.hours_to_empty != null && r.hours_to_empty < 24) ||
        r.forecast_6h < r.reserve_target,
    )
    .slice(0, 8);
  for (const r of hot) {
    lines.push(
      `${r.name}: stock ${Math.round(r.current_stock)} tradable ${Math.round(r.tradable)} net/h ${r.net_per_hour.toFixed(1)} 6h~${Math.round(r.forecast_6h)}${r.trade_opportunity ? ` [${r.trade_opportunity}]` : ""}`,
    );
  }
  if (state.embargoes.length) {
    const e = state.embargoes[state.embargoes.length - 1]!;
    lines.push(
      `Latest embargo: ${e.nation ?? e.playerId ?? "?"} @ ${e.t}`,
    );
  }
  if (state.warOperations.length) {
    lines.push(
      `War ops reserved: ${state.warOperations.map((o) => o.name).join(", ")}`,
    );
  }
  return lines.join("\n");
}

export async function refreshFinanceFromTools(
  rootDir: string,
  resourcesRaw: unknown,
  marketRaw: unknown,
): Promise<FinanceState> {
  const config = await loadMarketConfig(rootDir);
  const prev = await loadFinanceState(rootDir);
  const resources = buildResourceModel(
    resourcesRaw,
    marketRaw,
    config,
    prev,
  );
  const state: FinanceState = {
    updatedAt: new Date().toISOString(),
    cash: prev?.cash,
    resources,
    embargoes: prev?.embargoes ?? [],
    warOperations: prev?.warOperations ?? [],
    config,
  };
  await saveFinanceState(rootDir, state);
  for (const r of resources) {
    if (r.trade_opportunity === "SHORTAGE_WARNING" || r.trade_opportunity === "PANIC_BUY") {
      await getEventBus(rootDir).publish("RESOURCE_SHORTAGE_FORECAST", {
        source: "finance",
        payload: { resource: r.name, hours_to_empty: r.hours_to_empty },
      });
    }
  }
  return state;
}
