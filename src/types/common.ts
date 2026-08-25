/** Shared primitive geometry / IDs used across state and actions. */

export type PlayerId = number;
export type UserId = number;
export type GameId = number;
export type ArmyId = number;
export type ProvinceId = number;
export type LocationId = number;
export type UnitTypeId = number;
export type ResourceId = number;
export type RequestId = number | string;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface TimedValue {
  readonly amount: number;
  /** Game-internal rate (not always UI hourly). */
  readonly rate: number;
  readonly production: number;
  readonly consumption: number;
}
