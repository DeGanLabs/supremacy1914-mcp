import type {
  DataQuality,
  FinanceMode,
  FinancePicture,
  FinanceProvince,
  RawFinanceInput,
  ResourceRow,
} from "./types.js";
import {
  computeHealth,
  daysToZero,
  hoursToZero,
  projectStatusAt,
  statusFromHours,
} from "./health.js";
import {
  computeEfficiency,
  computeInfraScore,
  estimateInvested,
  isCapitalWasted,
  provinceRole,
} from "./efficiency.js";
import {
  annotateProvinceRisks,
  buildNationalFailures,
  buildNationalThreats,
} from "./failures.js";
import { detectBottleneck } from "./bottleneck.js";
import { buildDoNext, buildCandidatesForProvince, marketOpportunities } from "./capital.js";
import { buildRankings, scoreProvinceAsset, scoreProvinceProblem } from "./rankings.js";
import { buildFinanceBrief } from "./format.js";

function isDoubleResource(resourceType: string | null | undefined): boolean {
  if (!resourceType) return false;
  return /double|\+/i.test(resourceType) || resourceType.includes(",");
}

function toResourceRows(
  resources: RawFinanceInput["resources"],
): ResourceRow[] {
  return resources.map((r) => {
    const h = hoursToZero(r.amount, r.rate);
    return {
      id: r.id,
      name: r.name,
      amount: r.amount,
      production: r.production,
      consumption: r.consumption,
      rate: r.rate,
      isCritical: !!r.isCritical || (h != null && h <= 6),
      hoursToZero: h,
      daysToZero: daysToZero(r.amount, r.rate),
    };
  });
}

export function buildFinancePicture(raw: RawFinanceInput): FinancePicture {
  const mode: FinanceMode = raw.mode ?? "economy";
  const resources = toResourceRows(raw.resources);
  const moneyRow = resources.find((r) => /money|gold|geld|cash/i.test(r.name));
  const moneyRate = moneyRow?.rate ?? null;
  const grain = resources.find((r) => /grain|food|fisch|fish/i.test(r.name));
  const grainCritical = !!grain && (grain.isCritical || (grain.hoursToZero ?? 99) <= 12);

  const warDemand = raw.warDemand ?? [];
  const market = marketOpportunities(raw.market ?? []);
  const bottleneck = detectBottleneck(resources, warDemand);

  const doNext = buildDoNext(raw.provinces, {
    money: raw.money,
    resources,
    bottleneck,
    warDemand,
    mode,
    grainCritical,
  });

  const provinces: FinanceProvince[] = raw.provinces.map((p) => {
    const buildings = p.buildings ?? [];
    const efficiencyScore = computeEfficiency({
      resourceType: p.resourceType ?? null,
      isDouble: isDoubleResource(p.resourceType),
      morale: p.morale,
      mainProduction: p.mainProduction ?? null,
      buildings,
    });
    const infraScore = computeInfraScore(buildings);
    const investedEstimate = estimateInvested(buildings);
    const { wasted, utilizationPct } = isCapitalWasted({
      invested: investedEstimate,
      efficiencyScore,
      morale: p.morale,
      mainProduction: p.mainProduction ?? null,
    });
    const risks = annotateProvinceRisks(
      {
        id: p.id,
        name: p.name,
        resourceType: p.resourceType ?? null,
        isDouble: isDoubleResource(p.resourceType),
        morale: p.morale,
        efficiencyScore,
        capitalWasted: wasted,
        buildings,
      },
      grainCritical,
    );
    const cands = buildCandidatesForProvince(p, {
      money: raw.money,
      resources,
      bottleneck,
      warDemand,
      mode,
      grainCritical,
    });
    const bestAction =
      cands.find(
        (c) =>
          c.affordable &&
          c.action === "constructBuilding" &&
          (c.blockedBy.includes("none") || c.blockedBy.length === 0),
      ) ??
      cands.find((c) => c.affordable) ??
      cands[0] ??
      null;
    const hint =
      market.find((m) => m.name.toLowerCase() === (p.resourceType || "").toLowerCase())
        ?.hint ?? "NONE";

    let warPressure = 0;
    for (const wd of warDemand) {
      if (wd.status !== "active") continue;
      warPressure += 0.2 * wd.priority;
    }

    const role = provinceRole(
      p.resourceType ?? null,
      isDoubleResource(p.resourceType),
      buildings,
    );

    const prov: FinanceProvince = {
      id: p.id,
      name: p.name,
      capital: p.capital,
      coastal: p.coastal,
      resourceType: p.resourceType ?? null,
      isDouble: isDoubleResource(p.resourceType),
      mainProduction: p.mainProduction ?? null,
      taxProduction: p.taxProduction ?? null,
      efficiencyScore,
      buildings,
      queue: (p.constructions as unknown[]) ?? [],
      infraScore,
      investedEstimate,
      morale: p.morale,
      revoltChance: p.revoltChance ?? null,
      bestAction,
      capitalWasted: wasted,
      utilizationPct,
      failureCodes: risks.failureCodes,
      threatCodes: risks.threatCodes,
      forecasts: {
        at6h: (p.morale ?? 100) < 45 ? "warning" : "ok",
        at12h: (p.morale ?? 100) < 50 ? "warning" : "ok",
        at24h: efficiencyScore < 40 ? "warning" : "ok",
      },
      warPressure: Math.min(1, warPressure),
      events: (raw.events ?? []).filter((e) => e.line.includes(p.name)).slice(-8),
      marketHint: hint,
      role,
      assetScore: 0,
      problemScore: 0,
      borders: p.borders ?? [],
      bounds: p.bounds ?? null,
      terrainType: p.terrainType ?? null,
    };
    return {
      ...prov,
      assetScore: scoreProvinceAsset(prov, mode),
      problemScore: scoreProvinceProblem(prov),
    };
  });

  const avgInfra =
    provinces.length === 0
      ? 50
      : provinces.reduce((s, p) => s + p.infraScore, 0) / provinces.length;

  const tradeScore = Math.min(
    12,
    market.filter((m) => m.hint === "BUY").length * 4 +
      market.filter((m) => m.hint === "WATCH").length * 2,
  );

  const warUncovered = warDemand.filter((w) => {
    if (w.status !== "active") return false;
    for (const [k, need] of Object.entries(w.needed)) {
      const row = resources.find(
        (r) => r.name.toLowerCase() === k.toLowerCase(),
      );
      if (row && row.amount < need) return true;
    }
    return false;
  }).length;

  const health = computeHealth({
    resources,
    money: raw.money,
    moneyRate,
    avgInfra,
    tradeScore,
    criticalCount: resources.filter((r) => r.isCritical).length,
    warUncovered,
  });

  const hoursList = resources
    .map((r) => r.hoursToZero)
    .filter((h): h is number => h != null);
  const minHours = hoursList.length ? Math.min(...hoursList) : null;

  const nationalFailures = buildNationalFailures(resources, raw.money, moneyRate);
  const nationalThreats = buildNationalThreats(resources);
  const rankings = buildRankings(provinces, doNext, mode);

  const dataQuality: DataQuality = {
    percent: 0,
    sources: {
      nationalEconomy: resources.length ? "VERIFIED" : "MISSING",
      provinceBuildings: provinces.some((p) => p.buildings.length)
        ? "VERIFIED"
        : provinces.length
          ? "PARTIAL"
          : "MISSING",
      market: (raw.market?.length ?? 0) > 0 ? "VERIFIED" : "MISSING",
      provinceAttribution: provinces.some((p) => p.mainProduction != null)
        ? "PARTIAL"
        : "MISSING",
      relations: (raw.embargoes?.length ?? 0) >= 0 ? "PARTIAL" : "MISSING",
      warDemand: warDemand.length ? "VERIFIED" : "MISSING",
    },
  };
  const vals = Object.values(dataQuality.sources);
  const dqPercent = Math.round(
    (vals.filter((v) => v === "VERIFIED").length * 100 +
      vals.filter((v) => v === "PARTIAL").length * 50) /
      Math.max(1, vals.length),
  );
  const dataQualityFinal: DataQuality = {
    ...dataQuality,
    percent: dqPercent,
  };

  const nationalBase = {
    resources,
    money: raw.money,
    moneyRate,
    health,
    bottleneck,
    failures: [
      ...nationalFailures,
      ...provinces.flatMap((p) =>
        p.failureCodes.map((code) => ({
          code,
          severity: "medium" as const,
          line: `${p.name}: ${code}`,
          provinceIds: [p.id] as number[],
          confidence: "estimate" as const,
        })),
      ),
    ].slice(0, 40),
    threats: nationalThreats,
    rankings,
    forecasts: {
      statusNow: statusFromHours(minHours),
      status6h: projectStatusAt(resources, 6),
      status12h: projectStatusAt(resources, 12),
      status24h: projectStatusAt(resources, 24),
    },
    market,
    embargoes: raw.embargoes ?? [],
    warDemand,
    dataQuality: dataQualityFinal,
    mode,
    financeBrief: {
      economyLine: "",
      bottleneckLine: "",
      doNextLine: "",
      capitalLine: "",
      marketLine: "",
      warLine: "",
      riskLine: "",
    },
    doNext,
    minHoursToZero: minHours,
  };
  nationalBase.financeBrief = buildFinanceBrief(nationalBase);

  return {
    generatedAt: new Date().toISOString(),
    selfPlayerId: raw.selfPlayerId,
    mapSize: raw.mapSize,
    national: nationalBase,
    provinces,
    whatIf: null,
  };
}
