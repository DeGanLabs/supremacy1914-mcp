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

const DEFAULT_RESOURCE_IDS = [0, 1, 2, 3, 4, 5, 6, 20] as const;

export function readEconomyFromResourceState(
  state: RawResourceState,
  resourceIds: readonly number[] = DEFAULT_RESOURCE_IDS,
): EconomySnapshot {
  const resources: ResourceSnapshot[] = [];
  const byName: Record<string, ResourceSnapshot> = {};

  for (const id of resourceIds) {
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
