import type { BottleneckInfo, ResourceRow, WarDemand } from "./types.js";

export function detectBottleneck(
  resources: readonly ResourceRow[],
  warDemand: readonly WarDemand[] = [],
): BottleneckInfo | null {
  let best: BottleneckInfo | null = null;
  let bestStress = -1;

  for (const r of resources) {
    const deficit = r.consumption - r.production;
    const hours = r.hoursToZero;
    let stress = 0;
    if (r.rate < 0) stress += 40 + Math.min(40, (-r.rate) / 10);
    if (hours != null) stress += Math.max(0, 30 - hours);
    if (r.isCritical) stress += 25;
    if (deficit > 0) stress += Math.min(20, deficit / 20);

    for (const wd of warDemand) {
      if (wd.status !== "active") continue;
      const need = wd.needed[r.name] ?? wd.needed[r.name.toLowerCase()] ?? 0;
      if (need > r.amount) stress += 20;
      else if (need > r.amount * 0.5) stress += 10;
    }

    if (stress > bestStress) {
      bestStress = stress;
      best = {
        resourceId: r.id,
        name: r.name,
        production: r.production,
        consumption: r.consumption,
        deficit: Math.max(0, deficit),
        hoursToZero: hours,
        line: `${r.name}: prod ${r.production.toFixed(1)} cons ${r.consumption.toFixed(1)} rate ${r.rate.toFixed(2)}/h`,
      };
    }
  }

  return bestStress >= 15 ? best : best;
}
