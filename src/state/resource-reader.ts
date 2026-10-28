import type { EconomySnapshot, ResourceSnapshot } from "../types/resources.js";

export interface RawResourceEntry {
  getAmount(): number;
  getProduction(): number;
  getConsumption(): number;
  getRate(): number;
  isRateCritical?: () => boolean;
}

export interface RawResourceState {
  getPlayerMoneyAmount(): number;
  getResourceName(id: number): string | null | undefined;
  getPlayerResourceEntry(id: number): RawResourceEntry | null | undefined;
}

const DEFAULT_RESOURCE_IDS = Array.from({ length: 31 }, (_, i) => i).concat([20]);

export function readEconomyFromResourceState(
  state: RawResourceState,
  resourceIds: readonly number[] = DEFAULT_RESOURCE_IDS,
): EconomySnapshot {
  const resources: ResourceSnapshot[] = [];
  const byName: Record<string, ResourceSnapshot> = {};

  for (const id of [...new Set(resourceIds)]) {
    const name = state.getResourceName(id);
    const entry = state.getPlayerResourceEntry(id);
    if (!name || !entry) continue;

    const snap: ResourceSnapshot = {
      id,
      name,
      amount: entry.getAmount(),
      production: entry.getProduction(),
      consumption: entry.getConsumption(),
      rate: entry.getRate(),
      isCritical: entry.isRateCritical?.() ?? false,
    };
    resources.push(snap);
    byName[name.toLowerCase()] = snap;
  }

  return {
    money: state.getPlayerMoneyAmount(),
    resources,
    byName,
  };
}

export function readEconomyFromHup(hup: {
  gameState: { getResourceState(): RawResourceState };
}): EconomySnapshot {
  return readEconomyFromResourceState(hup.gameState.getResourceState());
}
