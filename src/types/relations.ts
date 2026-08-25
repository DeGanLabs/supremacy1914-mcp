import type { PlayerId } from "./common.js";

/** Official relation ints from UltForeignAffairRelations statics. */
export const RelationLevel = {
  REVOLT: -10,
  WAR: -2,
  CEASEFIRE: -1,
  TRADE_EMBARGO: 0,
  PEACE: 1,
  NON_AGRESSION_PACT: 2,
  RIGHT_OF_WAY: 3,
  VIEW_MILITARY_ACTIONS: 4,
  MUTUAL_PROTECTION: 5,
  SHARED_INTELLIGENCE: 6,
  MILITARY_AUTHORITY: 7,
} as const;

export type RelationLevelValue =
  (typeof RelationLevel)[keyof typeof RelationLevel];

export const RelationLabel: Record<number, string> = {
  [RelationLevel.REVOLT]: "revolt",
  [RelationLevel.WAR]: "war",
  [RelationLevel.CEASEFIRE]: "ceasefire",
  [RelationLevel.TRADE_EMBARGO]: "trade_embargo",
  [RelationLevel.PEACE]: "peace",
  [RelationLevel.NON_AGRESSION_PACT]: "non_aggression_pact",
  [RelationLevel.RIGHT_OF_WAY]: "right_of_way",
  [RelationLevel.VIEW_MILITARY_ACTIONS]: "view_military_actions",
  [RelationLevel.MUTUAL_PROTECTION]: "mutual_protection",
  [RelationLevel.SHARED_INTELLIGENCE]: "shared_intelligence",
  [RelationLevel.MILITARY_AUTHORITY]: "military_authority",
};

export interface CountryRelationFlags {
  readonly atWar: boolean;
  readonly hasRightOfWay: boolean;
  readonly isFriendly: boolean;
  readonly canAttack: boolean;
  readonly canTrade: boolean;
  readonly canSeeArmies: boolean;
  readonly canSeeEachOthersArmies: boolean;
  readonly canCommandProvinces: boolean;
  readonly canUseAirfields: boolean;
}

export interface CountryRelation {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly nationName: string;
  readonly relation: number;
  readonly relationLabel: string;
  readonly superficial?: string;
  readonly honorPeriodEnd?: number;
  readonly defeated: boolean;
  readonly retired: boolean;
  readonly rankingOrder?: number;
  readonly coalitionName?: string;
  readonly flags: CountryRelationFlags;
}

export interface DiplomacyMatrixSnapshot {
  readonly selfPlayerId: PlayerId;
  readonly relations: readonly CountryRelation[];
  readonly atWar: readonly CountryRelation[];
  readonly rightOfWay: readonly CountryRelation[];
  readonly shareMapOrBetter: readonly CountryRelation[];
  readonly enemies: readonly PlayerId[];
  readonly allies: readonly PlayerId[];
  readonly byRelationValue: Readonly<Record<string, number>>;
}
