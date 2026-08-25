import type { ArmyId, LocationId, PlayerId, Vec2 } from "./common.js";
import type { UnitStack } from "./army.js";

export interface VisibleArmyView {
  readonly id: ArmyId;
  readonly ownerId: PlayerId;
  readonly ownerName: string | null;
  readonly nation: string | null;
  readonly locationId: LocationId;
  readonly position: Vec2;
  readonly provinceName: string | null;
  readonly onSea: boolean;
  /** False = fog marker only (composition unknown). */
  readonly detailsVisible: boolean;
  readonly units: readonly UnitStack[];
  readonly morale: number | null;
  readonly spyRevealedTime: number | null;
  readonly commandCount: number;
}

export interface ProvinceMapView {
  readonly id: LocationId;
  readonly name: string;
  readonly ownerId: PlayerId;
  readonly ownerName: string | null;
  readonly nation: string | null;
  readonly morale: number | null;
  readonly coastal: boolean;
  readonly unknownUpgradeCount: number;
  readonly visibleUpgradeCount: number;
  readonly stationaryArmyId: number | null;
  readonly capital: Vec2 | null;
}

export interface CountryMapSummary {
  readonly playerId: PlayerId;
  readonly name: string | null;
  readonly nation: string | null;
  readonly provinceCount: number;
  readonly armyCount: number;
  readonly armiesWithDetails: number;
  readonly armiesFogged: number;
  readonly relationFromSelf: number | null;
}

export interface WorldViewSnapshot {
  readonly selfPlayerId: PlayerId;
  readonly mapSize: { width: number; height: number };
  readonly provinceCount: number;
  readonly armyCount: number;
  readonly visibleArmyCount: number;
  readonly countries: CountryMapSummary[];
  readonly provinces: ProvinceMapView[];
  readonly armies: VisibleArmyView[];
}
