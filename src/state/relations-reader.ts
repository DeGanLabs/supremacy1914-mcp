import type { PlayerId } from "../types/common.js";
import {
  RelationLabel,
  RelationLevel,
  type CountryRelation,
  type DiplomacyMatrixSnapshot,
} from "../types/relations.js";
import type { PlayerCombatStats } from "../types/stats.js";
import { readPlayerCombatStats, type RawPlayerStatisticsState } from "./stats-reader.js";

export interface RawRelationsApi {
  getRelation(from: number, to: number): number;
  canTrade?(from: number, to: number): boolean;
  getEndOfHonorPeriod?(from: number, to: number): number;
  superficialRelationBetween?(from: number, to: number): string;
  neighborRelations?: Record<string, Record<string, number>>;
}

export interface RawForeignAffairsRelationsApi {
  getRelations(): RawRelationsApi;
  isAtWar?(a: number, b: number): boolean;
  hasRightOfWay?(a: number, b: number): boolean;
  isFriendlyPlayer?(a: number, b: number): boolean;
  canAttack?(a: number, b: number): boolean;
  canSeeArmies?(a: number, b: number): boolean;
  canSeeEachOthersArmies?(a: number, b: number): boolean;
  canCommandProvinces?(a: number, b: number): boolean;
  canUseAirfields?(a: number, b: number): boolean;
  getEnemies?(playerId: number): number[] | Record<string, unknown>;
  getAllies?(playerId: number): number[] | Record<string, unknown>;
}

export interface RawRelationPlayer {
  getPlayerID(): number;
  getName?: () => string;
  getNationName?: () => string;
  isDefeated?: () => boolean;
  isRetired?: () => boolean;
  getRankingOrder?: () => number;
  getCoalition?: () => { getName?: () => string } | string | null;
}

function asIdList(value: number[] | Record<string, unknown> | null | undefined): PlayerId[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number);
  return Object.keys(value).map(Number);
}

function coalitionName(
  raw: { getName?: () => string } | string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw;
  return raw.getName?.();
}

export function relationLabel(value: number): string {
  return RelationLabel[value] ?? `relation_${value}`;
}

export function mapCountryRelation(
  selfPlayerId: PlayerId,
  player: RawRelationPlayer,
  fa: RawForeignAffairsRelationsApi,
): CountryRelation {
  const playerId = player.getPlayerID();
  const rel = fa.getRelations();
  const relation = rel.getRelation(selfPlayerId, playerId);

  return {
    playerId,
    name: player.getName?.() ?? `player${playerId}`,
    nationName: player.getNationName?.() ?? "",
    relation,
    relationLabel: relationLabel(relation),
    superficial: rel.superficialRelationBetween?.(selfPlayerId, playerId),
    honorPeriodEnd: rel.getEndOfHonorPeriod?.(selfPlayerId, playerId),
    defeated: player.isDefeated?.() ?? false,
    retired: player.isRetired?.() ?? false,
    rankingOrder: player.getRankingOrder?.(),
    coalitionName: coalitionName(player.getCoalition?.() ?? null),
    flags: {
      atWar: fa.isAtWar?.(selfPlayerId, playerId) ?? relation <= RelationLevel.WAR,
      hasRightOfWay:
        fa.hasRightOfWay?.(selfPlayerId, playerId) ??
        relation >= RelationLevel.RIGHT_OF_WAY,
      isFriendly:
        fa.isFriendlyPlayer?.(selfPlayerId, playerId) ??
        relation >= RelationLevel.RIGHT_OF_WAY,
      canAttack: fa.canAttack?.(selfPlayerId, playerId) ?? true,
      canTrade: rel.canTrade?.(selfPlayerId, playerId) ?? relation > RelationLevel.TRADE_EMBARGO,
      canSeeArmies: fa.canSeeArmies?.(selfPlayerId, playerId) ?? false,
      canSeeEachOthersArmies:
        fa.canSeeEachOthersArmies?.(selfPlayerId, playerId) ?? false,
      canCommandProvinces: fa.canCommandProvinces?.(selfPlayerId, playerId) ?? false,
      canUseAirfields: fa.canUseAirfields?.(selfPlayerId, playerId) ?? false,
    },
  };
}

export function readDiplomacyMatrix(
  selfPlayerId: PlayerId,
  players: readonly RawRelationPlayer[],
  fa: RawForeignAffairsRelationsApi,
): DiplomacyMatrixSnapshot {
  const relations = players
    .filter((p) => p.getPlayerID() !== selfPlayerId && Boolean(p.getNationName?.()))
    .map((p) => mapCountryRelation(selfPlayerId, p, fa))
    .sort((a, b) => a.relation - b.relation || (a.rankingOrder ?? 999) - (b.rankingOrder ?? 999));

  const byRelationValue: Record<string, number> = {};
  for (const r of relations) {
    byRelationValue[String(r.relation)] = (byRelationValue[String(r.relation)] ?? 0) + 1;
  }

  return {
    selfPlayerId,
    relations,
    atWar: relations.filter((r) => r.flags.atWar),
    rightOfWay: relations.filter(
      (r) => r.relation >= RelationLevel.RIGHT_OF_WAY && r.relation < RelationLevel.VIEW_MILITARY_ACTIONS,
    ),
    shareMapOrBetter: relations.filter(
      (r) => r.relation >= RelationLevel.VIEW_MILITARY_ACTIONS,
    ),
    enemies: asIdList(fa.getEnemies?.(selfPlayerId)),
    allies: asIdList(fa.getAllies?.(selfPlayerId)),
    byRelationValue,
    neighborRelations: fa.getRelations().neighborRelations,
  };
}

export interface KnownCountryStats {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly nationName: string;
  readonly rankingOrder?: number;
  readonly defeated: boolean;
  readonly coalitionName?: string;
  readonly relation?: CountryRelation;
  readonly combat?: PlayerCombatStats;
}

export function readKnownCountryStats(input: {
  selfPlayerId: PlayerId;
  players: readonly RawRelationPlayer[];
  foreignAffairs: RawForeignAffairsRelationsApi;
  statistics: RawPlayerStatisticsState;
  /** If set, only these player IDs (e.g. spy-known). Else all nations. */
  onlyPlayerIds?: readonly PlayerId[];
}): KnownCountryStats[] {
  const allow = input.onlyPlayerIds ? new Set(input.onlyPlayerIds) : null;
  const matrix = readDiplomacyMatrix(
    input.selfPlayerId,
    input.players,
    input.foreignAffairs,
  );
  const byId = new Map(matrix.relations.map((r) => [r.playerId, r]));

  return input.players
    .filter((p) => {
      const id = p.getPlayerID();
      if (id === input.selfPlayerId) return false;
      if (!p.getNationName?.()) return false;
      if (allow && !allow.has(id)) return false;
      return true;
    })
    .map((p) => {
      const playerId = p.getPlayerID();
      return {
        playerId,
        name: p.getName?.() ?? `player${playerId}`,
        nationName: p.getNationName?.() ?? "",
        rankingOrder: p.getRankingOrder?.(),
        defeated: p.isDefeated?.() ?? false,
        coalitionName: coalitionName(p.getCoalition?.() ?? null),
        relation: byId.get(playerId),
        combat: readPlayerCombatStats(input.statistics, playerId),
      };
    })
    .sort((a, b) => (a.rankingOrder ?? 999) - (b.rankingOrder ?? 999));
}

export function readDiplomacyMatrixFromHup(hup: {
  config: { userData: { playerID: number } };
  gameState: {
    getForeignAffairsState(): RawForeignAffairsRelationsApi;
    getPlayerState(): { getPlayersArray(): RawRelationPlayer[] };
  };
}): DiplomacyMatrixSnapshot {
  return readDiplomacyMatrix(
    hup.config.userData.playerID,
    hup.gameState.getPlayerState().getPlayersArray(),
    hup.gameState.getForeignAffairsState(),
  );
}

export function readKnownCountriesFromHup(
  hup: {
    config: { userData: { playerID: number } };
    gameState: {
      getForeignAffairsState(): RawForeignAffairsRelationsApi;
      getPlayerState(): { getPlayersArray(): RawRelationPlayer[] };
      getPlayerStatisticsState(): RawPlayerStatisticsState;
    };
  },
  onlyPlayerIds?: readonly PlayerId[],
): KnownCountryStats[] {
  return readKnownCountryStats({
    selfPlayerId: hup.config.userData.playerID,
    players: hup.gameState.getPlayerState().getPlayersArray(),
    foreignAffairs: hup.gameState.getForeignAffairsState(),
    statistics: hup.gameState.getPlayerStatisticsState(),
    onlyPlayerIds,
  });
}
