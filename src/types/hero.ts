import type { ArmyId, ProvinceId } from "./common.js";

export interface HeroSnapshot {
  readonly itemId: number;
  readonly name: string;
  readonly shortName: string;
  readonly level: number;
  readonly rarity: string | null;
  readonly unitTypeId: number | null;
  readonly obtained: boolean;
  readonly deployed: boolean;
  readonly onCooldown: boolean;
  readonly cooldownSeconds: number;
  readonly limitReached: boolean;
  readonly locked: boolean;
  /** Scenario day when this hero unlocks (client getDayOfAvailability). */
  readonly dayOfAvailability: number | null;
  /** True when current game day >= dayOfAvailability. */
  readonly dayReached: boolean;
  readonly moraleThreshold?: number;
  /** Owned, not deployed, not on cooldown, not locked, day gate passed */
  readonly canDeploy: boolean;
}

export interface DeployedHeroArmy {
  readonly armyId: ArmyId;
  readonly provinceId: ProvinceId | null;
  readonly provinceName: string | null;
  readonly pos: { x: number; y: number };
  readonly heroes: readonly {
    readonly unitTypeId: number;
    readonly name: string | null;
    readonly shortName: string | null;
    readonly level?: number;
    readonly rarity?: string | null;
    readonly cooldownSeconds?: number;
  }[];
}

export interface HeroesSnapshot {
  readonly maxDeployed: number;
  readonly deployedCount: number;
  readonly inventory: HeroSnapshot[];
  readonly deployed: HeroSnapshot[];
  readonly deployable: HeroSnapshot[];
  readonly onCooldown: HeroSnapshot[];
  readonly deployedOnMap: DeployedHeroArmy[];
}
