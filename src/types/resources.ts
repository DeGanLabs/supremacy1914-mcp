import type { ResourceId, TimedValue } from "./common.js";

export interface ResourceSnapshot {
  readonly id: ResourceId;
  readonly name: string;
  readonly amount: number;
  readonly production: number;
  readonly consumption: number;
  readonly rate: number;
  readonly isCritical: boolean;
}

export interface EconomySnapshot {
  readonly money: number;
  readonly resources: readonly ResourceSnapshot[];
  readonly byName: Readonly<Record<string, ResourceSnapshot>>;
}

export type { TimedValue };
