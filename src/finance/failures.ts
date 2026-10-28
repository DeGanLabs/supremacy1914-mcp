import type {
  ConfidenceLevel,
  IssueItem,
  ResourceRow,
  FinanceProvince,
} from "./types.js";
import { hasBuilding } from "./efficiency.js";

const THREAT_HOURS = 24;

export function buildNationalFailures(
  resources: readonly ResourceRow[],
  money: number,
  moneyRate: number | null,
): IssueItem[] {
  const out: IssueItem[] = [];
  for (const r of resources) {
    if (r.isCritical || (r.rate < 0 && (r.hoursToZero ?? 999) <= 6)) {
      out.push({
        code: "CRITICAL_RATE",
        severity: "high",
        line: `${r.name} critical — rate ${r.rate.toFixed(2)}/h, ~${r.hoursToZero?.toFixed(1) ?? "?"}h left`,
        resourceId: r.id,
        confidence: "verified",
      });
    }
  }
  if (money < 500 || (moneyRate != null && moneyRate < -50 && money < 5000)) {
    out.push({
      code: "MONEY_STARVE",
      severity: money < 200 ? "high" : "medium",
      line: `Cash pressure — money ${Math.round(money)}, rate ${moneyRate ?? "?"}`,
      confidence: "verified",
    });
  }
  return out;
}

export function buildNationalThreats(resources: readonly ResourceRow[]): IssueItem[] {
  const out: IssueItem[] = [];
  for (const r of resources) {
    const h = r.hoursToZero;
    if (h == null) continue;
    if (h > 6 && h <= THREAT_HOURS) {
      out.push({
        code: "RATE_THREAT",
        severity: h <= 12 ? "medium" : "low",
        line: `${r.name} goes empty in ~${h.toFixed(1)}h at current rate`,
        resourceId: r.id,
        confidence: "verified",
      });
    }
  }
  return out;
}

export function annotateProvinceRisks(
  p: {
    id: number;
    name: string;
    resourceType: string | null;
    isDouble: boolean;
    morale: number | null;
    efficiencyScore: number;
    capitalWasted: boolean;
    buildings: readonly { id?: number | null; name: string | null }[];
  },
  grainCritical: boolean,
): { failureCodes: string[]; threatCodes: string[]; issues: IssueItem[] } {
  const failureCodes: string[] = [];
  const threatCodes: string[] = [];
  const issues: IssueItem[] = [];
  const conf: ConfidenceLevel = "inference";

  const slots = p.buildings.map((b) => ({
    id: b.id ?? null,
    name: b.name,
  }));
  const barracks = hasBuilding(slots, /barrack/i);
  if (grainCritical && barracks.hit) {
    failureCodes.push("BARRACKS_SUSPECT");
    issues.push({
      code: "BARRACKS_SUSPECT",
      severity: "medium",
      line: `${p.name}: barracks while grain stressed (suspect burn)`,
      provinceIds: [p.id],
      confidence: conf,
    });
  }

  const factory = hasBuilding(slots, /factory/i);
  const workshop = hasBuilding(slots, /workshop/i);
  if (
    (p.isDouble || p.resourceType) &&
    !factory.hit &&
    !workshop.hit &&
    (p.resourceType || "").length > 0
  ) {
    failureCodes.push("RICH_IDLE");
    issues.push({
      code: "RICH_IDLE",
      severity: "medium",
      line: `${p.name}: rich/idle — no workshop/factory`,
      provinceIds: [p.id],
      confidence: "estimate",
    });
  }

  if (p.morale != null && p.morale < 50) {
    failureCodes.push("MORALE_LOW");
    issues.push({
      code: "MORALE_LOW",
      severity: p.morale < 35 ? "high" : "medium",
      line: `${p.name}: morale ${Math.round(p.morale)}%`,
      provinceIds: [p.id],
      confidence: "verified",
    });
  } else if (p.morale != null && p.morale < 60) {
    threatCodes.push("MORALE_DRIFT");
  }

  if (p.capitalWasted) {
    failureCodes.push("CAPITAL_WASTED");
    issues.push({
      code: "CAPITAL_WASTED",
      severity: "medium",
      line: `${p.name}: capital underutilized`,
      provinceIds: [p.id],
      confidence: "estimate",
    });
  }

  if (p.efficiencyScore < 40) {
    threatCodes.push("LOW_EFFICIENCY");
  }

  return { failureCodes, threatCodes, issues };
}

export function collectProvinceIssues(
  provinces: readonly FinanceProvince[],
): IssueItem[] {
  const out: IssueItem[] = [];
  for (const p of provinces) {
    for (const code of p.failureCodes) {
      out.push({
        code,
        severity: code === "MORALE_LOW" && (p.morale ?? 100) < 35 ? "high" : "medium",
        line: `${p.name}: ${code}`,
        provinceIds: [p.id],
        confidence: code === "MORALE_LOW" ? "verified" : "estimate",
      });
    }
  }
  return out;
}
