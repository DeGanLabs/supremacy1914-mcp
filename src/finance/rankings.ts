import type {
  FinanceMode,
  FinanceProvince,
  FinanceActionCandidate,
  RankingRow,
} from "./types.js";

function modeWeights(mode: FinanceMode): {
  eco: number;
  mil: number;
  survival: number;
} {
  if (mode === "warEconomy") return { eco: 0.35, mil: 0.55, survival: 0.1 };
  if (mode === "emergency") return { eco: 0.15, mil: 0.15, survival: 0.7 };
  return { eco: 0.7, mil: 0.2, survival: 0.1 };
}

export function scoreProvinceAsset(
  p: FinanceProvince,
  mode: FinanceMode,
): number {
  const w = modeWeights(mode);
  const eco =
    p.efficiencyScore * 0.5 +
    Math.min(40, (p.mainProduction ?? 0) / 5) +
    (p.morale ?? 50) * 0.2;
  const mil = p.warPressure * 100 + (p.coastal ? 5 : 0);
  const survival = (p.morale ?? 50) * 0.5 + (100 - (p.failureCodes.length * 15));
  return Math.round(eco * w.eco + mil * w.mil + survival * w.survival);
}

export function scoreProvinceProblem(p: FinanceProvince): number {
  let s = 100 - p.efficiencyScore;
  s += p.failureCodes.length * 12;
  s += p.threatCodes.length * 6;
  if (p.capitalWasted) s += 15;
  if (p.morale != null && p.morale < 50) s += 20;
  return Math.min(100, Math.round(s));
}

export function buildRankings(
  provinces: readonly FinanceProvince[],
  doNext: readonly FinanceActionCandidate[],
  mode: FinanceMode,
): {
  topAssets: RankingRow[];
  topProblems: RankingRow[];
  bestInvestments: RankingRow[];
} {
  const withAsset = provinces
    .map((p) => ({
      provinceId: p.id,
      provinceName: p.name,
      score: scoreProvinceAsset(p, mode),
      note: p.role,
    }))
    .sort((a, b) => b.score - a.score);

  const withProblem = provinces
    .map((p) => ({
      provinceId: p.id,
      provinceName: p.name,
      score: scoreProvinceProblem(p),
      note: p.failureCodes[0] ?? p.threatCodes[0],
    }))
    .sort((a, b) => b.score - a.score);

  const bestInvestments = doNext.slice(0, 8).map((c) => ({
    provinceId: c.provinceId,
    provinceName: c.provinceName,
    score: Math.round(c.combinedScore ?? c.priority),
    note: c.upgradeName ?? c.action,
  }));

  return {
    topAssets: withAsset.slice(0, 8),
    topProblems: withProblem.filter((r) => r.score >= 30).slice(0, 8),
    bestInvestments,
  };
}
