import type {
  BlockReason,
  BottleneckInfo,
  ExplainKey,
  FinanceActionCandidate,
  FinanceMode,
  RawFinanceProvinceDump,
  ResourceRow,
  WarDemand,
} from "./types.js";
import { hasBuilding } from "./efficiency.js";

const FEE = 0.02;
const MONEY_ID = 20;

function upgradeCostGuess(name: string): number {
  if (/factory/i.test(name)) return 6000;
  if (/rail/i.test(name)) return 3500;
  if (/workshop/i.test(name)) return 2500;
  if (/barrack/i.test(name)) return 2000;
  if (/harbour|harbor|airfield|fort/i.test(name)) return 4000;
  return 2000;
}

function normalizeCosts(
  raw: Record<string | number, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    const id = Number(k);
    const amt = Number(v);
    if (Number.isFinite(id) && Number.isFinite(amt) && amt > 0) {
      out[String(id)] = amt;
    }
  }
  return out;
}

function stockAmount(
  resources: readonly ResourceRow[],
  money: number,
  resourceId: number,
): number {
  if (resourceId === MONEY_ID) return money;
  const row = resources.find((r) => r.id === resourceId);
  return row?.amount ?? 0;
}

function resourceName(
  resources: readonly ResourceRow[],
  resourceId: number,
): string {
  if (resourceId === MONEY_ID) return "Money";
  return resources.find((r) => r.id === resourceId)?.name ?? `res#${resourceId}`;
}

function affordCheck(
  costs: Record<string, number>,
  money: number,
  resources: readonly ResourceRow[],
): {
  affordable: boolean;
  missing: { resourceId: number; name: string; need: number; have: number }[];
  moneyCost: number;
} {
  const missing: {
    resourceId: number;
    name: string;
    need: number;
    have: number;
  }[] = [];
  let moneyCost = 0;
  for (const [idStr, need] of Object.entries(costs)) {
    const id = Number(idStr);
    if (id === MONEY_ID) moneyCost = need;
    const have = stockAmount(resources, money, id);
    if (have < need) {
      missing.push({
        resourceId: id,
        name: resourceName(resources, id),
        need,
        have,
      });
    }
  }
  return { affordable: missing.length === 0, missing, moneyCost };
}

function militaryValue(
  name: string,
  warDemand: readonly WarDemand[],
  resourceType: string | null,
): number {
  let s = 20;
  if (/rail/i.test(name)) s += 35;
  if (/factory/i.test(name)) s += 25;
  if (/barrack/i.test(name)) s += warDemand.some((w) => w.status === "active") ? 30 : 5;
  if (/harbour|harbor|airfield/i.test(name)) s += 20;
  if (warDemand.length && resourceType) s += 10;
  return Math.min(100, s);
}

export function buildCandidatesForProvince(
  p: RawFinanceProvinceDump,
  ctx: {
    money: number;
    resources: readonly ResourceRow[];
    bottleneck: BottleneckInfo | null;
    warDemand: readonly WarDemand[];
    mode: FinanceMode;
    grainCritical: boolean;
  },
): FinanceActionCandidate[] {
  const buildings = p.buildings ?? [];
  const upgrades = p.upgrades ?? [];
  const out: FinanceActionCandidate[] = [];

  const reserveFloor =
    ctx.mode === "emergency" ? ctx.money * 0.4 : ctx.money * 0.1;

  for (const u of upgrades) {
    const costs = normalizeCosts(u.costs);
    const hasRealCosts = Object.keys(costs).length > 0;
    const guess = upgradeCostGuess(u.name);
    if (!hasRealCosts && u.moneyCost == null) {
      costs[String(MONEY_ID)] = guess;
    } else if (!hasRealCosts && u.moneyCost != null) {
      costs[String(MONEY_ID)] = u.moneyCost;
    }

    const check = affordCheck(costs, ctx.money, ctx.resources);
    const cost =
      check.moneyCost > 0
        ? check.moneyCost
        : u.moneyCost != null && u.moneyCost > 0
          ? u.moneyCost
          : guess;

    const explainKeys: ExplainKey[] = [];
    const blockedBy: BlockReason[] = [];

    if (
      p.isDouble ||
      (!!p.resourceType &&
        (/double|\+/i.test(p.resourceType) || p.resourceType.includes(",")))
    ) {
      explainKeys.push("DOUBLE_RESOURCE");
    }
    if (/factory/i.test(u.name) && !hasBuilding(buildings, /factory/i).hit) {
      explainKeys.push("FACTORY_MISSING");
    }
    if (/workshop/i.test(u.name) && !hasBuilding(buildings, /workshop/i).hit) {
      explainKeys.push("WORKSHOP_MISSING");
    }
    if (/rail/i.test(u.name) && !hasBuilding(buildings, /rail/i).hit) {
      explainKeys.push("RAIL_MISSING");
    }
    if (ctx.bottleneck && /factory|workshop|rail/i.test(u.name)) {
      const bn = ctx.bottleneck.name.toLowerCase();
      if (/iron|eisen/i.test(bn)) explainKeys.push("IRON_BOTTLENECK");
      if (/grain|food|fisch|grain/i.test(bn)) explainKeys.push("GRAIN_BOTTLENECK");
      if (/oil|öl|oil/i.test(bn)) explainKeys.push("OIL_BOTTLENECK");
      if (/money|gold|geld/i.test(bn)) explainKeys.push("MONEY_BOTTLENECK");
    }
    if ((p.morale ?? 100) < 55) explainKeys.push("LOW_MORALE");

    const affordable =
      typeof u.affordable === "boolean" ? u.affordable && check.affordable : check.affordable;
    if (!affordable) blockedBy.push("not_affordable");
    if (ctx.money - cost < reserveFloor && ctx.mode !== "economy") {
      blockedBy.push("money_reserve_floor");
    }
    if (ctx.mode === "emergency" && !/rail|harbour|harbor/i.test(u.name)) {
      blockedBy.push("emergency_freeze");
    }
    if (ctx.grainCritical && /barrack/i.test(u.name)) {
      blockedBy.push("grain_crisis");
      explainKeys.push("BARRACKS_OVERBURN");
    }
    if (ctx.warDemand.some((w) => w.status === "active")) {
      explainKeys.push("WAR_DEMAND");
    }
    if (affordable && blockedBy.length === 0) explainKeys.push("AFFORDABLE");
    if (blockedBy.length === 0) blockedBy.push("none");

    const isDouble =
      !!p.isDouble ||
      (!!p.resourceType &&
        (/double|\+/i.test(p.resourceType) || p.resourceType.includes(",")));
    const economicScore = Math.min(
      100,
      40 +
        (isDouble ? 20 : 0) +
        (/factory/i.test(u.name) ? 25 : 0) +
        (/workshop/i.test(u.name) ? 15 : 0) +
        (/rail/i.test(u.name) ? 10 : 0) -
        (blockedBy.includes("not_affordable") ? 40 : 0),
    );
    const militaryScore = militaryValue(
      u.name,
      ctx.warDemand,
      p.resourceType ?? null,
    );
    const w =
      ctx.mode === "warEconomy"
        ? { e: 0.35, m: 0.65 }
        : ctx.mode === "emergency"
          ? { e: 0.2, m: 0.3 }
          : { e: 0.75, m: 0.25 };
    const combinedScore = Math.round(economicScore * w.e + militaryScore * w.m);
    const netBenefitPerHour = /factory/i.test(u.name)
      ? 40
      : /workshop/i.test(u.name)
        ? 18
        : /rail/i.test(u.name)
          ? 12
          : 8;
    const paybackHours = cost / Math.max(1, netBenefitPerHour);

    out.push({
      provinceId: p.id,
      provinceName: p.name,
      action: "constructBuilding",
      upgradeId: u.upgradeId,
      upgradeName: u.name,
      cost,
      resourceCosts: costs,
      missingResources: check.missing,
      priority: combinedScore,
      explainKeys: [...new Set(explainKeys)],
      blockedBy: blockedBy.filter((b) => b !== "none").length
        ? blockedBy.filter((b) => b !== "none")
        : (["none"] as BlockReason[]),
      affordable,
      economicScore,
      militaryScore,
      combinedScore,
      confidence: hasRealCosts ? "verified" : "estimate",
      netBenefitPerHour,
      paybackHours: Math.round(paybackHours * 10) / 10,
    });
  }

  return out.sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0));
}

export function buildDoNext(
  provinces: readonly RawFinanceProvinceDump[],
  ctx: {
    money: number;
    resources: readonly ResourceRow[];
    bottleneck: BottleneckInfo | null;
    warDemand: readonly WarDemand[];
    mode: FinanceMode;
    grainCritical: boolean;
  },
  limit = 10,
): FinanceActionCandidate[] {
  const all: FinanceActionCandidate[] = [];
  for (const p of provinces) {
    all.push(...buildCandidatesForProvince(p, ctx));
  }
  return all
    .filter((c) => c.action === "constructBuilding")
    .sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0))
    .slice(0, limit);
}

export function marketOpportunities(
  books: readonly {
    resourceId: number;
    name: string;
    price: number | null;
    asks?: { limit: number }[];
    bids?: { limit: number }[];
  }[],
): {
  resourceId: number;
  name: string;
  buy: number | null;
  sell: number | null;
  feePct: number;
  netMarginPct: number | null;
  hint: "BUY" | "WATCH" | "AVOID" | "NONE";
}[] {
  return books.map((b) => {
    const buy = b.asks?.[0]?.limit ?? b.price ?? null;
    const sell = b.bids?.[0]?.limit ?? null;
    let netMarginPct: number | null = null;
    let hint: "BUY" | "WATCH" | "AVOID" | "NONE" = "WATCH";
    if (buy != null && sell != null && buy > 0) {
      netMarginPct = ((sell * (1 - FEE) - buy) / buy) * 100;
      if (netMarginPct > 2) hint = "BUY";
      else if (netMarginPct < -2) hint = "AVOID";
    } else if (buy == null && sell == null) {
      hint = "NONE";
    }
    return {
      resourceId: b.resourceId,
      name: b.name,
      buy,
      sell,
      feePct: FEE * 100,
      netMarginPct,
      hint,
    };
  });
}
