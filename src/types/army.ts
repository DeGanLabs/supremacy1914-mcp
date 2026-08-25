import type { ArmyId, LocationId, PlayerId, UnitTypeId, Vec2 } from "./common.js";

export type ArmyCommandKind =
  | "goto"
  | "wait"
  | "delay"
  | "attack"
  | "patrol"
  | "split"
  | "deploy"
  | "convert"
  | "reload"
  | "upgrade"
  | "unknown";

export interface UnitStack {
  readonly typeId: UnitTypeId;
  readonly size: number;
  readonly name?: string;
  readonly morale?: number;
}

export interface ArmyCommandView {
  readonly kind: ArmyCommandKind;
  readonly start?: Vec2;
  readonly target?: Vec2;
  readonly waitSeconds?: number;
  readonly targetArmyId?: ArmyId;
  readonly rawClass?: string;
  readonly wireClass?: string;
}

export interface ArmySnapshot {
  readonly id: ArmyId;
  readonly ownerId: PlayerId;
  readonly locationId: LocationId;
  readonly position: Vec2;
  readonly onSea: boolean;
  readonly provinceName?: string;
  readonly provinceOwnerId?: PlayerId;
  readonly units: readonly UnitStack[];
  readonly commands: readonly ArmyCommandView[];
}

export interface MoveArmyParams {
  readonly armyId: ArmyId;
  /** Absolute map target. Pathfinding should be supplied by the executor. */
  readonly target: Vec2;
  /** Keep existing path and append (Add Target). */
  readonly append?: boolean;
  readonly forcedMarch?: boolean;
}

export interface StopArmyParams {
  readonly armyId: ArmyId;
}

export interface AttackArmyParams {
  readonly armyId: ArmyId;
  readonly targetArmyId: ArmyId;
  readonly targetPosition?: Vec2;
}

export interface DelayArmyParams {
  readonly armyId: ArmyId;
  /** Delay duration in whole minutes (UI Delay control). */
  readonly minutes: number;
  /** If true, clamp so arrival doesn't exceed the longest sibling path. */
  readonly syncArrival?: boolean;
}

export interface ForcedMarchParams {
  readonly armyId: ArmyId;
  readonly enabled: boolean;
}

export interface SetAggressionParams {
  readonly armyId: ArmyId;
  /** 1–5 typical; 0 = default. */
  readonly aggressiveness: number;
}
