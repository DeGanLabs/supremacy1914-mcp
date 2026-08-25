import type {
  DiplomacyEdge,
  DiplomacySnapshot,
  PlayerSnapshot,
} from "../types/diplomacy.js";
import type { PlayerId } from "../types/common.js";

export interface RawPlayer {
  getPlayerID(): number;
  getName?: () => string;
  getNationName?: () => string;
  getUserID?: () => number;
}

export interface RawRelations {
  getRelation(from: number, to: number): number;
}

export interface RawForeignAffairs {
  getRelations(): RawRelations;
  isAtWar?(a: number, b: number): boolean;
  hasRightOfWay?(a: number, b: number): boolean;
  isFriendlyPlayer?(a: number, b: number): boolean;
}

export interface RawPlayerState {
  getPlayersArray(): RawPlayer[];
}

export function readDiplomacy(
  selfPlayerId: PlayerId,
  playerState: RawPlayerState,
  foreignAffairs: RawForeignAffairs,
): DiplomacySnapshot {
  const relations = foreignAffairs.getRelations();
  const players: PlayerSnapshot[] = playerState.getPlayersArray().map((p) => ({
    playerId: p.getPlayerID(),
    name: p.getName?.() ?? `player${p.getPlayerID()}`,
    nationName: p.getNationName?.() ?? "",
    userId: p.getUserID?.(),
  }));

  const edges: DiplomacyEdge[] = [];
  for (const p of players) {
    if (p.playerId === selfPlayerId) continue;
    const relation = relations.getRelation(selfPlayerId, p.playerId);
    edges.push({
      fromPlayerId: selfPlayerId,
      toPlayerId: p.playerId,
      relation,
      atWar: foreignAffairs.isAtWar?.(selfPlayerId, p.playerId) ?? relation < 0,
      hasRightOfWay:
        foreignAffairs.hasRightOfWay?.(selfPlayerId, p.playerId) ?? false,
      isFriendly:
        foreignAffairs.isFriendlyPlayer?.(selfPlayerId, p.playerId) ??
        relation >= 3,
    });
  }

  return { selfPlayerId, players, edges };
}

export function readDiplomacyFromHup(hup: {
  config: { userData: { playerID: number } };
  gameState: {
    getPlayerState(): RawPlayerState;
    getForeignAffairsState(): RawForeignAffairs;
  };
}): DiplomacySnapshot {
  return readDiplomacy(
    hup.config.userData.playerID,
    hup.gameState.getPlayerState(),
    hup.gameState.getForeignAffairsState(),
  );
}
