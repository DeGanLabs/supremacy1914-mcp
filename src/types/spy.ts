import type { PlayerId, ProvinceId, ArmyId } from "./common.js";

export const SpyMissionType = {
  WITHOUT: 0,
  DEFENCE: 1,
  INTELLIGENCE: 2,
  ECONOMICAL_SABOTAGE: 3,
  MILITARY_SABOTAGE: 4,
} as const;

export type SpyMissionTypeValue =
  (typeof SpyMissionType)[keyof typeof SpyMissionType];

export interface SpyAgent {
  readonly unitUid: number;
  readonly ownerId: PlayerId;
  readonly locationId: LocationIdLike;
  readonly provinceName?: string;
  readonly provinceOwnerId?: PlayerId;
  readonly missionType: number;
  readonly missionName: string;
  readonly morale: number;
  readonly size: number;
  readonly kills: number;
  readonly dailyCosts: number;
  readonly onSea: boolean;
  readonly atAirfield: boolean;
}

type LocationIdLike = number;

export interface SpyJobResult {
  readonly day: number;
  readonly time: number;
  readonly name: string;
  readonly jobName: string;
  readonly description: string;
  readonly mission: number;
  readonly spyOwnerId: PlayerId;
  readonly opponentId: PlayerId;
  readonly provinceId: ProvinceId;
  readonly amount: number;
  readonly premium: boolean;
  readonly countryWide: boolean;
}

export interface SpyKnownArmy {
  readonly armyId: ArmyId;
  readonly ownerId: PlayerId;
  readonly locationId: number;
  readonly units: readonly { name?: string; size: number }[];
}

export interface SpyKnownProvince {
  readonly name?: string;
  readonly provinceId?: ProvinceId;
}

export interface SpyDayIntel {
  readonly day: number;
  readonly knownPlayerIds: readonly PlayerId[];
  readonly jobs: readonly SpyJobResult[];
  readonly knownArmies: readonly SpyKnownArmy[];
  readonly provincesByPlayer: Readonly<
    Record<string, readonly SpyKnownProvince[]>
  >;
}

export interface SpySnapshotDetailed {
  readonly totals: {
    readonly all: number;
    readonly idle: number;
    readonly onMission: number;
    readonly dailyCosts: number;
    readonly dailyCostsOnMission: number;
  };
  readonly agents: readonly SpyAgent[];
  readonly currentDay: number;
  readonly availableDays: readonly number[];
  readonly latestIntel?: SpyDayIntel;
  readonly intelByDay: readonly SpyDayIntel[];
}
