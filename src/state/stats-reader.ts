import type { PlayerId } from "../types/common.js";
import type {
  AllianceMemberSnapshot,
  AllianceSnapshot,
  FullStatsSnapshot,
  GameEventSnapshot,
  GameInfoSnapshot,
  PlayerCombatStats,
  ProvinceSummary,
  ProvincesSnapshot,
  RankingEntry,
  SpySnapshot,
  StateMetaEntry,
  UnitStatRow,
} from "../types/stats.js";
import type { RawSpyState as RawSpyStateDetailed } from "./spy-reader.js";

export interface RawGameInfoState {
  getDayOfGame(): number;
  getRemainingDayTimeHR(): string;
  getNextDayTime(): number;
  getTimeScaleAsMultiplier(): number;
  getTimeScaleHR(): string;
  getNumberOfPlayers(): number;
  getOpenSlots(): number;
  getMapID(): number;
  getScenarioID(): number;
  getScenario(): { ingameName?: string } | null;
  getVictoryPoints(): number;
  getVictoryPercent(): number;
  getEndOfGame(): boolean;
  getClientTime?: () => number;
  getGsVersion?: () => string;
}

export interface RawPlayerStatisticsState {
  getNumKills(playerId: number): number;
  getNumDeaths(playerId: number): number;
  getNumProvincesCaptured(playerId: number): number;
  getNumProvincesLost(playerId: number): number;
  getNumConstructed(playerId?: number): number;
  getUnitStatsMap(): {
    unitType: {
      getName?: () => string;
      getID?: () => number;
      getStatsColumnID?: () => number;
    };
    killed: number;
    produced: number;
  }[];
}

export interface RawStatsPlayer {
  getPlayerID(): number;
  getName?: () => string;
  getNationName?: () => string;
  getRankingOrder?: () => number;
  isDefeated?: () => boolean;
  isRetired?: () => boolean;
  getCapitalID?: () => number;
  getTeamID?: () => number;
  getCoalition?: () => { getName?: () => string } | string | null;
}

export interface RawProvince {
  getName?: () => string;
  getProvinceID?: () => number;
  getOwnerID(): number;
  getMorale(): number;
  getMoraleTrendHR?: () => string;
  getPopulation?: () => number;
  getDisplayedPopulation?: () => number;
  getProductionType?: () => string;
  getMainProduction?: () => number;
  getTaxProduction?: () => number;
  getVictoryPoints?: () => number;
  getBuildingVictoryPoints?: () => number;
  getTotalVictoryPoints?: () => number;
  getRevoltChance?: () => number;
}

export interface RawAllianceMember {
  playerID?: number;
  allianceLeader?: boolean;
  joinDate?: number;
  getPlayerID?: () => number;
  getProfile?: () => { getName?: () => string; getNationName?: () => string } | null;
}

export interface RawAlliance {
  getID(): number;
  getName(): string;
  getDescription?: () => string;
  getLeaderID(): number;
  getMemberCount(): number;
  getProvinceCount(): number;
  getScore(): number;
  getMembers(): RawAllianceMember[];
}

export interface RawSpyStateBasic {
  getNumAllSpies(): number;
  getNumOfIdleSpies(): number;
  getNumSpiesOnMission(): number;
  getDailyCosts?: () => number;
  getDailyCostsOnMission?: () => number;
}

export interface RawGameEvent {
  eventID: number;
  key: string;
  name: string;
  description: string;
  time: number;
  status: number;
  type: number;
  filterID?: number;
  filterName?: string;
}

export interface RawGameStateForStats {
  getGameInfoState(): RawGameInfoState;
  getPlayerStatisticsState(): RawPlayerStatisticsState;
  getPlayerState(): { getPlayersArray(): RawStatsPlayer[]; getPlayer(id: number): RawStatsPlayer | null };
  getMapState(): { getPlayerProvinces(playerId: number): RawProvince[] };
  getInGameAllianceState(): { getAlliance(): RawAlliance | null };
  getSpyState(): RawSpyStateBasic | RawSpyStateDetailed | null;
  getGameEventState(): { getEvents(): RawGameEvent[] };
  getStatesList?: () => Record<string, { stateID?: string | number; stateType?: number; timeStamp?: number | string }>;
  getTimeStamp?: () => number;
}

function coalitionName(
  raw: { getName?: () => string } | string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw;
  return raw.getName?.();
}

export function readGameInfo(state: RawGameInfoState): GameInfoSnapshot {
  const scenario = state.getScenario();
  return {
    dayOfGame: state.getDayOfGame(),
    remainingDayLabel: state.getRemainingDayTimeHR(),
    nextDayTimestamp: state.getNextDayTime(),
    timeScaleMultiplier: state.getTimeScaleAsMultiplier(),
    timeScaleLabel: state.getTimeScaleHR(),
    numberOfPlayers: state.getNumberOfPlayers(),
    openSlots: state.getOpenSlots(),
    mapId: state.getMapID(),
    scenarioId: state.getScenarioID(),
    scenarioName: scenario?.ingameName,
    victoryPointsTarget: state.getVictoryPoints(),
    victoryPercent: state.getVictoryPercent(),
    endOfGame: state.getEndOfGame(),
    clientTime: state.getClientTime?.(),
    gsVersion: state.getGsVersion?.(),
  };
}

export function readPlayerCombatStats(
  state: RawPlayerStatisticsState,
  playerId: PlayerId,
): PlayerCombatStats {
  const units: UnitStatRow[] = (state.getUnitStatsMap() ?? [])
    .map((row) => ({
      name: row.unitType.getName?.() ?? "Unknown",
      typeId: row.unitType.getID?.(),
      statsColumnId: row.unitType.getStatsColumnID?.(),
      killed: row.killed ?? 0,
      produced: row.produced ?? 0,
    }))
    .filter((u) => u.killed > 0 || u.produced > 0);

  return {
    playerId,
    kills: state.getNumKills(playerId),
    deaths: state.getNumDeaths(playerId),
    provincesCaptured: state.getNumProvincesCaptured(playerId),
    provincesLost: state.getNumProvincesLost(playerId),
    constructed: state.getNumConstructed(playerId),
    units,
  };
}

export function readRanking(players: readonly RawStatsPlayer[]): RankingEntry[] {
  return players
    .map((p) => ({
      playerId: p.getPlayerID(),
      name: p.getName?.() ?? `player${p.getPlayerID()}`,
      nationName: p.getNationName?.() ?? "",
      rankingOrder: p.getRankingOrder?.() ?? Number.MAX_SAFE_INTEGER,
      defeated: p.isDefeated?.() ?? false,
      retired: p.isRetired?.() ?? false,
      capitalId: p.getCapitalID?.(),
      coalitionName: coalitionName(p.getCoalition?.() ?? null),
      teamId: p.getTeamID?.(),
    }))
    .filter((p) => Boolean(p.nationName))
    .sort((a, b) => a.rankingOrder - b.rankingOrder);
}

export function mapProvince(province: RawProvince): ProvinceSummary {
  return {
    provinceId: province.getProvinceID?.(),
    name: province.getName?.() ?? "Unknown",
    ownerId: province.getOwnerID(),
    morale: province.getMorale(),
    moraleTrend: province.getMoraleTrendHR?.(),
    population: province.getPopulation?.(),
    displayedPopulation: province.getDisplayedPopulation?.(),
    resourceType: province.getProductionType?.(),
    mainProduction: province.getMainProduction?.(),
    taxProduction: province.getTaxProduction?.(),
    victoryPoints: province.getVictoryPoints?.(),
    buildingVictoryPoints: province.getBuildingVictoryPoints?.(),
    totalVictoryPoints: province.getTotalVictoryPoints?.(),
    revoltChance: province.getRevoltChance?.(),
  };
}

export function readProvinces(
  mapState: { getPlayerProvinces(playerId: number): RawProvince[] },
  playerId: PlayerId,
): ProvincesSnapshot {
  const provinces = (mapState.getPlayerProvinces(playerId) ?? []).map(mapProvince);
  const averageMorale =
    provinces.length === 0
      ? 0
      : provinces.reduce((sum, p) => sum + p.morale, 0) / provinces.length;

  return {
    playerId,
    count: provinces.length,
    averageMorale,
    provinces,
  };
}

export function readAlliance(
  alliance: RawAlliance | null,
  players?: Map<number, { name?: string; nationName?: string }>,
): AllianceSnapshot | null {
  if (!alliance) return null;

  const members: AllianceMemberSnapshot[] = (alliance.getMembers() ?? []).map((m) => {
    const playerId = m.getPlayerID?.() ?? m.playerID ?? -1;
    const profile = m.getProfile?.();
    return {
      playerId,
      isLeader: Boolean(m.allianceLeader) || playerId === alliance.getLeaderID(),
      joinDate: m.joinDate,
      name: profile?.getName?.() ?? players?.get(playerId)?.name,
      nationName: profile?.getNationName?.() ?? players?.get(playerId)?.nationName,
    };
  });

  return {
    allianceId: alliance.getID(),
    name: alliance.getName(),
    description: alliance.getDescription?.(),
    leaderId: alliance.getLeaderID(),
    memberCount: alliance.getMemberCount(),
    provinceCount: alliance.getProvinceCount(),
    score: alliance.getScore(),
    members,
  };
}

export function readSpies(spyState: RawSpyStateBasic | null): SpySnapshot | null {
  if (!spyState) return null;
  return {
    totalSpies: spyState.getNumAllSpies(),
    idleSpies: spyState.getNumOfIdleSpies(),
    spiesOnMission: spyState.getNumSpiesOnMission(),
    dailyCosts: spyState.getDailyCosts?.(),
    dailyCostsOnMission: spyState.getDailyCostsOnMission?.(),
  };
}

export function readGameEvents(
  events: readonly RawGameEvent[] | null | undefined,
  limit = 50,
): GameEventSnapshot[] {
  return (events ?? [])
    .slice()
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map((e) => ({
      eventId: e.eventID,
      key: e.key,
      name: e.name,
      description: e.description,
      time: e.time,
      status: e.status,
      type: e.type,
      filterId: e.filterID,
      filterName: e.filterName,
    }));
}

export function readStateMeta(
  statesList: Record<string, { stateID?: string | number; stateType?: number; timeStamp?: number | string }> | null | undefined,
): StateMetaEntry[] {
  if (!statesList) return [];
  return Object.entries(statesList).map(([stateType, value]) => ({
    stateType: Number(stateType),
    stateId: value.stateID ?? "",
    timeStamp: value.timeStamp,
  }));
}

export function readFullStats(gs: RawGameStateForStats, selfPlayerId: PlayerId): FullStatsSnapshot {
  const players = gs.getPlayerState().getPlayersArray();
  const playerLookup = new Map(
    players.map((p) => [
      p.getPlayerID(),
      { name: p.getName?.(), nationName: p.getNationName?.() },
    ]),
  );
  const ranking = readRanking(players);
  const selfRank = ranking.find((r) => r.playerId === selfPlayerId);

  return {
    selfPlayerId,
    gameInfo: readGameInfo(gs.getGameInfoState()),
    combat: readPlayerCombatStats(gs.getPlayerStatisticsState(), selfPlayerId),
    ranking,
    selfRank,
    provinces: readProvinces(gs.getMapState(), selfPlayerId),
    alliance: readAlliance(gs.getInGameAllianceState().getAlliance(), playerLookup),
    spies: readSpies(gs.getSpyState()),
    recentEvents: readGameEvents(gs.getGameEventState().getEvents()),
    stateMeta: readStateMeta(gs.getStatesList?.()),
    serverTimestamp: gs.getTimeStamp?.(),
  };
}

export function readFullStatsFromHup(hup: {
  config: { userData: { playerID: number } };
  gameState: RawGameStateForStats;
}): FullStatsSnapshot {
  return readFullStats(hup.gameState, hup.config.userData.playerID);
}
