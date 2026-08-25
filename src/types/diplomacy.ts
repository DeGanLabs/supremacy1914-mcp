import type { PlayerId } from "./common.js";

/**
 * Numeric relation values observed in-client via `getRelation(a,b)`.
 * Exact enum labels may vary by client build — treat as opaque ints
 * and map via your session when needed.
 */
export type RelationValue = number;

export interface PlayerSnapshot {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly nationName: string;
  readonly userId?: number;
}

export interface DiplomacyEdge {
  readonly fromPlayerId: PlayerId;
  readonly toPlayerId: PlayerId;
  readonly relation: RelationValue;
  readonly atWar: boolean;
  readonly hasRightOfWay: boolean;
  readonly isFriendly: boolean;
}

export interface DiplomacySnapshot {
  readonly selfPlayerId: PlayerId;
  readonly players: readonly PlayerSnapshot[];
  readonly edges: readonly DiplomacyEdge[];
}
