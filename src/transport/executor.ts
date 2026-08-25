import type {
  ActionResult,
  AttackArmyParams,
  MoveArmyParams,
  StopArmyParams,
} from "../types/index.js";

/**
 * High-level executor. Implementations:
 * - BrowserBridgeExecutor: uses live A* + armyController.sendAction (preferred for moves)
 * - HttpActionExecutor: builds wire JSON and POSTs (needs precomputed path segments)
 */
export interface ArmyActionExecutor {
  move(params: MoveArmyParams): Promise<ActionResult>;
  stop(params: StopArmyParams): Promise<ActionResult>;
  attack(params: AttackArmyParams): Promise<ActionResult>;
}

export interface GameStateReader {
  refresh(): Promise<void> | void;
}
