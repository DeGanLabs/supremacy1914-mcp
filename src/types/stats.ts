import type { PlayerId, ProvinceId } from "./common.js";

export interface GameInfoSnapshot {
  readonly dayOfGame: number;
  readonly remainingDayLabel: string;
  readonly nextDayTimestamp: number;
  readonly timeScaleMultiplier: number;
  readonly timeScaleLabel: string;
  readonly numberOfPlayers: number;
  readonly openSlots: number;
  readonly mapId: number;
  readonly scenarioId: number;
  readonly scenarioName?: string;
  readonly victoryPointsTarget: number;
  readonly victoryPercent: number;
  readonly endOfGame: boolean;
  readonly clientTime?: number;
  readonly gsVersion?: string;
}

export interface UnitStatRow {
  readonly name: string;
  readonly typeId?: number;
  readonly statsColumnId?: number;
  readonly killed: number;
  readonly produced: number;
}

export interface PlayerCombatStats {
  readonly playerId: PlayerId;
  readonly kills: number;
  readonly deaths: number;
  readonly provincesCaptured: number;
  readonly provincesLost: number;
  readonly constructed: number;
  readonly units: readonly UnitStatRow[];
}

export interface RankingEntry {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly nationName: string;
  readonly rankingOrder: number;
  readonly defeated: boolean;
  readonly retired: boolean;
  readonly capitalId?: number;
  readonly coalitionName?: string;
  readonly teamId?: number;
}

export interface ProvinceSummary {
  readonly provinceId?: ProvinceId;
  readonly name: string;
  readonly ownerId: PlayerId;
  readonly morale: number;
  readonly moraleTrend?: string;
  readonly population?: number;
  readonly displayedPopulation?: number;
  readonly resourceType?: string;
  readonly mainProduction?: number;
  readonly taxProduction?: number;
  readonly victoryPoints?: number;
  readonly buildingVictoryPoints?: number;
  readonly totalVictoryPoints?: number;
  readonly revoltChance?: number;
}

export interface ProvincesSnapshot {
  readonly playerId: PlayerId;
  readonly count: number;
  readonly averageMorale: number;
  readonly provinces: readonly ProvinceSummary[];
}

export interface AllianceMemberSnapshot {
  readonly playerId: PlayerId;
  readonly isLeader: boolean;
  readonly joinDate?: number;
  readonly name?: string;
  readonly nationName?: string;
}

export interface AllianceSnapshot {
  readonly allianceId: number;
  readonly name: string;
  readonly description?: string;
  readonly leaderId: PlayerId;
  readonly memberCount: number;
  readonly provinceCount: number;
  readonly score: number;
  readonly members: readonly AllianceMemberSnapshot[];
}

export interface SpySnapshot {
  readonly totalSpies: number;
  readonly idleSpies: number;
  readonly spiesOnMission: number;
  readonly dailyCosts?: number;
  readonly dailyCostsOnMission?: number;
}

export interface GameEventSnapshot {
  readonly eventId: number;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly time: number;
  readonly status: number;
  readonly type: number;
  readonly filterId?: number;
  readonly filterName?: string;
}

export interface StateMetaEntry {
  readonly stateType: number;
  readonly stateId: string | number;
  readonly timeStamp?: number | string;
}

export interface FullStatsSnapshot {
  readonly selfPlayerId: PlayerId;
  readonly gameInfo: GameInfoSnapshot;
  readonly combat: PlayerCombatStats;
  readonly ranking: readonly RankingEntry[];
  readonly selfRank?: RankingEntry;
  readonly provinces: ProvincesSnapshot;
  readonly alliance?: AllianceSnapshot | null;
  readonly spies?: SpySnapshot | null;
  readonly recentEvents: readonly GameEventSnapshot[];
  readonly stateMeta: readonly StateMetaEntry[];
  readonly serverTimestamp?: number;
}
