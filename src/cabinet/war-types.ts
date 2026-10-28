/** Compressed war picture from get_war_picture + scored watch state. */

export type WatchLevel = "high" | "medium" | "low";

export type WarTriggerKind =
  | "NEW_WAR"
  | "WAR_ENDED"
  | "RELATION_DROP"
  | "HOSTILE_NEAR"
  | "NEW_VISIBLE_STACK"
  | "OWN_ARMY_CONTACT"
  | "SPY_REVEAL"
  | "FRONT_OPENED"
  | "FRONT_CLOSED"
  | "FORCE_RATIO_FLIP"
  | "IDLE_ON_HOT_FRONT"
  | "MULTI_FRONT"
  | "SPY_GAP_WAR_NEIGHBOR"
  | "REINFORCEMENT_WINDOW"
  | "SENSOR_DEGRADED"
  | "COASTAL_HOSTILE"
  | "EMBARKED_NEAR"
  | "FORT_COASTAL"
  | "RETREAT_COAST"
  | "NEED_SPY";

export interface WarDiploRow {
  readonly id: number;
  readonly name?: string;
  readonly nation?: string;
  readonly relation?: number;
  readonly label?: string;
  readonly war?: boolean;
  readonly defeated?: boolean;
  /** active | dormant | ghost | defeated */
  readonly status?: string;
  readonly provincesKnown?: number;
  readonly armiesKnown?: number;
}

export interface WarArmyCommand {
  readonly kind?: string;
  readonly waitSeconds?: number;
  readonly target?: { x?: number; y?: number };
  readonly targetArmyId?: number;
}

export interface WarArmyRow {
  readonly id: number;
  readonly province?: string | null;
  readonly pos?: { x: number; y: number } | null;
  readonly onSea?: boolean;
  readonly units?: ReadonlyArray<{ name?: string; size?: number; typeId?: number }>;
  /** Queue length (legacy) or command objects. */
  readonly commands?: number | ReadonlyArray<WarArmyCommand>;
  readonly commandCount?: number;
  readonly waitSeconds?: number;
  readonly speed?: number;
  readonly currentSpeed?: number;
  readonly forcedMarch?: boolean;
  readonly range?: number;
  readonly idle?: boolean;
  readonly morale?: number;
  readonly ownerId?: number;
  readonly owner?: string;
  readonly nation?: string;
  readonly distToSelf?: number;
  readonly distToBorder?: number | null;
  readonly atWar?: boolean;
  readonly detailsVisible?: boolean;
  readonly spyRevealed?: number;
}

export interface WarBorderRow {
  readonly province: string;
  readonly provinceId?: number;
  readonly morale?: number;
  readonly coastal?: boolean;
  readonly facingNation?: string;
  readonly facingPlayerId: number;
  readonly facingProvince?: string;
  readonly distance: number;
  readonly relation?: number | null;
  readonly relationLabel?: string | null;
  readonly atWar?: boolean;
}

export interface WarFrontRow {
  readonly name: string;
  readonly playerId: number;
  readonly level: WatchLevel;
  readonly relation?: string | null;
  readonly atWar?: boolean;
  readonly status?: string;
  readonly provincesKnown?: number;
  readonly armiesKnown?: number;
  readonly borderProvinces: string[];
  readonly ownArmyIds: number[];
  readonly hostileArmyIds: number[];
  readonly nearestHostile?: {
    armyId: number;
    province?: string | null;
    distance: number;
    onSea?: boolean;
  } | null;
  readonly ownStrength?: number;
  readonly hostileStrength?: number;
}

export interface WarPictureRaw {
  readonly takenAt?: string;
  readonly gameId: number;
  readonly myPlayerId: number;
  readonly myNation: string;
  readonly day?: number;
  readonly timeScale?: number | string;
  readonly medianSpacing?: number;
  readonly borderBand?: number;
  readonly sensorDegraded?: boolean;
  readonly diplo?: {
    readonly atWar?: WarDiploRow[];
    readonly atWarPaper?: WarDiploRow[];
    readonly ceasefire?: WarDiploRow[];
    readonly embargo?: WarDiploRow[];
    readonly nap?: WarDiploRow[];
    readonly rightOfWay?: WarDiploRow[];
    readonly shareMapOrBetter?: WarDiploRow[];
    readonly allies?: number[];
    readonly coalitionName?: string;
    readonly coalitionMembers?: WarDiploRow[];
  };
  readonly ownArmies?: WarArmyRow[];
  readonly ownProvinces?: ReadonlyArray<{
    readonly id?: number;
    readonly name?: string;
    readonly capital?: { readonly x: number; readonly y: number } | null;
    readonly morale?: number | null;
    readonly coastal?: boolean;
    readonly unknownUpgradeCount?: number;
    readonly visibleUpgradeCount?: number;
    readonly stationaryArmyId?: number | null;
    readonly improvements?: ReadonlyArray<{ name?: string; id?: number; condition?: number }>;
    readonly revoltChance?: number | null;
    readonly mainProduction?: unknown;
    readonly taxProduction?: unknown;
    readonly resourceType?: unknown;
  }>;
  readonly foreignArmies?: WarArmyRow[];
  readonly borders?: WarBorderRow[];
  readonly fronts?: WarFrontRow[];
  readonly spies?: {
    readonly agents?: ReadonlyArray<{
      province?: string | null;
      provinceOwner?: number;
      mission?: string;
      morale?: number;
      dailyCosts?: number;
      kills?: number;
      size?: number;
      onSea?: boolean;
      atAirfield?: boolean;
    }>;
    readonly fog?: ReadonlyArray<{
      playerId: number;
      nation?: string;
      reason?: string;
    }>;
    readonly latestIntel?: unknown;
  };
  readonly heroes?: unknown;
  readonly totals?: Record<string, number>;
}

export interface WatchZone {
  readonly id: string;
  readonly level: WatchLevel;
  readonly nation: string;
  readonly playerId: number;
  readonly provinces: string[];
  readonly ownArmyIds: number[];
  readonly hostileArmyIds: number[];
  readonly note: string;
  readonly tags: string[];
}

export interface WarTrigger {
  readonly kind: WarTriggerKind;
  readonly level: WatchLevel;
  readonly key: string;
  readonly line: string;
  readonly armyId?: number;
  readonly province?: string;
  readonly nation?: string;
  readonly escalateAll?: boolean;
  readonly needSpyProvince?: string;
  readonly handoff?: "foreign" | "finance" | "intel";
}

export interface WarWatchSnapshot {
  readonly takenAt: string;
  readonly gameId: number;
  readonly myPlayerId: number;
  readonly myNation: string;
  readonly day?: number;
  readonly timeScale?: number | string;
  readonly medianSpacing?: number;
  readonly sensorDegraded: boolean;
  readonly atWar: WarDiploRow[];
  readonly zones: WatchZone[];
  readonly fronts: WarFrontRow[];
  readonly triggers: WarTrigger[];
  readonly picture: WarPictureRaw;
  readonly alertKeys: Record<string, string>;
}

export interface WarAlert {
  readonly level: WatchLevel;
  readonly line: string;
  readonly escalateAll: boolean;
  readonly trigger: WarTrigger;
}
