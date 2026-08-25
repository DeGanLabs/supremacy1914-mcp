import type {
  ActionResult,
  AttackArmyParams,
  MoveArmyParams,
  StopArmyParams,
  Vec2,
} from "../types/index.js";
import type { ArmyActionExecutor } from "./executor.js";

export interface BrowserHupArmyApi {
  armySelection: {
    setSelected(armies: unknown[], additive?: boolean): void;
    getSelectedArmyIDs(): number[];
  };
  gameState: {
    getArmyState(): {
      getArmy(id: number): BrowserArmy | null | undefined;
    };
    getMapState(): {
      closestMapPoint(point: unknown, needsWater: boolean): Vec2;
    };
  };
  mapMouseController: {
    armyController: {
      updateMoveSelection(): void;
      setCommandMode(mode: number): void;
      setDragTarget(target: unknown, attackedArmy: unknown): void;
      sendAction(): void;
      isValidCommand: boolean;
      message?: string;
      moveArmies: { size: number };
    };
  };
  config: {
    userData: { playerID: number };
  };
}

export interface BrowserArmy {
  getArmyID(): number;
  getOwnerID(): number;
  getPosition(): Vec2 & {
    constructor: new (x?: number, y?: number) => Vec2;
    clone(): Vec2;
  };
  isSelectable(): boolean;
  getCommands(): unknown[];
}

export type HupAccessor = () => BrowserHupArmyApi;

/**
 * Drives the real client controllers (pathfinding + signing + POST).
 * This is the safest automation path for moves.
 */
export class BrowserBridgeExecutor implements ArmyActionExecutor {
  constructor(private readonly getHup: HupAccessor) {}

  async move(params: MoveArmyParams): Promise<ActionResult> {
    const hup = this.getHup();
    const army = hup.gameState.getArmyState().getArmy(params.armyId);
    if (!army) {
      return { ok: false, requestId: -1, error: `Army ${params.armyId} not found` };
    }
    if (army.getOwnerID() !== hup.config.userData.playerID) {
      return { ok: false, requestId: -1, error: `Army ${params.armyId} is not owned by you` };
    }

    const Point = army.getPosition().constructor;
    const rawTarget = new Point(params.target.x, params.target.y);
    const target = hup.gameState.getMapState().closestMapPoint(rawTarget, false);

    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    // 0 = NONE → deduce MOVE/ATTACK from target
    ac.setCommandMode(0);
    ac.setDragTarget(target, null);

    if (!ac.isValidCommand) {
      return {
        ok: false,
        requestId: -1,
        error: ac.message || "Invalid move command",
      };
    }

    ac.sendAction();
    return {
      ok: true,
      requestId: `browser-move-${params.armyId}`,
      raw: {
        armyId: params.armyId,
        target,
        selected: hup.armySelection.getSelectedArmyIDs(),
      },
    };
  }

  async stop(params: StopArmyParams): Promise<ActionResult> {
    // Skeleton: wire to armyController stop command mode when you capture its enum value.
    return {
      ok: false,
      requestId: -1,
      error: `stop() skeleton — capture STOP commandMode enum then implement (army ${params.armyId})`,
    };
  }

  async attack(params: AttackArmyParams): Promise<ActionResult> {
    const hup = this.getHup();
    const army = hup.gameState.getArmyState().getArmy(params.armyId);
    if (!army) {
      return { ok: false, requestId: -1, error: `Army ${params.armyId} not found` };
    }
    if (army.getOwnerID() !== hup.config.userData.playerID) {
      return { ok: false, requestId: -1, error: `Army ${params.armyId} is not owned by you` };
    }

    const targetArmy = hup.gameState.getArmyState().getArmy(params.targetArmyId);
    if (!targetArmy) {
      return {
        ok: false,
        requestId: -1,
        error: `Target army ${params.targetArmyId} not found`,
      };
    }

    const Point = army.getPosition().constructor;
    const raw =
      params.targetPosition ??
      ({ x: targetArmy.getPosition().x, y: targetArmy.getPosition().y } as Vec2);
    const target = hup.gameState
      .getMapState()
      .closestMapPoint(new Point(raw.x, raw.y), false);

    hup.armySelection.setSelected([army]);
    const ac = hup.mapMouseController.armyController;
    ac.updateMoveSelection();
    // Y0.ATTACK = 2
    ac.setCommandMode(2);
    ac.setDragTarget(target, targetArmy);

    if (!ac.isValidCommand) {
      return {
        ok: false,
        requestId: -1,
        error: ac.message || "Invalid attack command",
      };
    }

    ac.sendAction();
    return {
      ok: true,
      requestId: `browser-attack-${params.armyId}-${params.targetArmyId}`,
      raw: {
        armyId: params.armyId,
        targetArmyId: params.targetArmyId,
        target,
      },
    };
  }
}
