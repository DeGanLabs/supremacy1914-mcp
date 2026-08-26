import type {
  FinanceBriefStruct,
  FinanceNational,
  FinancePicture,
  WhatIfInput,
  WhatIfResult,
} from "./types.js";
import { projectStatusAt } from "./health.js";

export function buildFinanceBrief(n: FinanceNational): FinanceBriefStruct {
  const st = n.forecasts.statusNow;
  const st12 = n.forecasts.status12h;
  return {
    economyLine: `${st} now; ${st12} in 12h (health ${n.health.total}/100)`,
    bottleneckLine: n.bottleneck
      ? `${n.bottleneck.name} — ${n.bottleneck.line}`
      : "None clear",
    doNextLine: n.doNext[0]
      ? `${n.doNext[0].upgradeName ?? n.doNext[0].action} @ ${n.doNext[0].provinceName} (prio ${n.doNext[0].priority})`
      : "No build candidate",
    capitalLine: n.rankings.bestInvestments[0]
      ? `${n.rankings.bestInvestments[0].note} — ${n.rankings.bestInvestments[0].provinceName}`
      : "Hold cash",
    marketLine: n.market.find((m) => m.hint === "BUY")
      ? `Buy ${n.market.find((m) => m.hint === "BUY")!.name} (~${n.market.find((m) => m.hint === "BUY")!.netMarginPct?.toFixed(1)}% net)`
      : "No strong market edge",
    warLine: n.warDemand.filter((w) => w.status === "active").length
      ? n.warDemand
          .filter((w) => w.status === "active")
          .map((w) => w.name)
          .join(", ")
      : "No active war demand",
    riskLine:
      n.failures.some((f) => f.severity === "high")
        ? "High"
        : n.threats.length || n.failures.length
          ? "Medium"
          : "Low",
  };
}

export function formatFinanceBrief(picture: FinancePicture): string {
  const b = picture.national.financeBrief;
  const dq = picture.national.dataQuality;
  return [
    `Finance picture @ ${picture.generatedAt}`,
    `Health ${picture.national.health.total}/100 | mode=${picture.national.mode} | data ${dq.percent}%`,
    `ECONOMY: ${b.economyLine}`,
    `BOTTLENECK: ${b.bottleneckLine}`,
    `DO NEXT: ${b.doNextLine}`,
    `CAPITAL: ${b.capitalLine}`,
    `MARKET: ${b.marketLine}`,
    `WAR: ${b.warLine}`,
    `RISK: ${b.riskLine}`,
    `Failures: ${picture.national.failures.length} | Threats: ${picture.national.threats.length}`,
  ].join("\n");
}

export function simulateWhatIf(
  picture: FinancePicture,
  input: WhatIfInput,
): WhatIfResult {
  const hours = input.hours ?? 24;
  const notes: string[] = [];
  let moneyDelta = 0;
  const projected = picture.national.resources.map((r) => {
    let rate = r.rate;
    let amount = r.amount + rate * hours;
    if (input.disableBarracksProvinceIds?.length && /grain|food|fisch/i.test(r.name)) {
      rate += 15 * input.disableBarracksProvinceIds.length;
      amount = r.amount + rate * hours;
      notes.push(`Assumed +15/h grain per disabled barracks (${input.disableBarracksProvinceIds.length})`);
    }
    for (const buy of input.buyResource ?? []) {
      if (buy.resourceId === r.id) {
        amount += buy.amount;
        moneyDelta -= buy.amount * 2;
        notes.push(`Buy ${buy.amount} ${r.name}`);
      }
    }
    return { id: r.id, name: r.name, amount, rate };
  });
  for (const b of input.build ?? []) {
    moneyDelta -= 4000;
    notes.push(`Build ${b.upgradeName} @ province ${b.provinceId} (cost estimate)`);
  }
  const asRows = projected.map((p) => {
    const base = picture.national.resources.find((r) => r.id === p.id)!;
    return {
      ...base,
      amount: p.amount,
      rate: p.rate,
      hoursToZero: p.rate < 0 ? p.amount / -p.rate : null,
      daysToZero: p.rate < 0 ? p.amount / -p.rate / 24 : null,
    };
  });
  notes.push(`Projected status @${hours}h: ${projectStatusAt(asRows, 0)}`);
  return { hours, projected, moneyDelta, notes };
}
