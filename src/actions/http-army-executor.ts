import type {
  ActionResult,
  AttackArmyParams,
  MoveArmyParams,
  StopArmyParams,
} from "../types/index.js";
import type { SessionConfig } from "../types/auth.js";
import type { ActionTransport } from "../transport/types.js";
import type { ArmyActionExecutor } from "../transport/executor.js";
import {
  buildSignedArmyAttackAction,
  buildSignedArmyMoveAction,
  buildWireUnits,
} from "./army-action-builder.js";
import type { GotoSegment } from "../types/actions.js";

export interface PathProvider {
  /**
   * Must return goto segments the server accepts.
   * Prefer BrowserBridgeExecutor for live A*; HTTP path needs a real pathfinder.
   */
  buildMovePath(params: MoveArmyParams): Promise<GotoSegment[]> | GotoSegment[];
}

export interface ArmyWireContextProvider {
  getArmyWireContext(armyId: number): Promise<{
    ownerId: number;
    units: { typeId: number; size: number }[];
    armySize?: number;
  }>;
}

/**
 * HTTP executor: builds UltArmyAction wire JSON and POSTs it.
 * Requires a PathProvider — raw single-segment paths may be rejected / suboptimal.
 */
export class HttpArmyActionExecutor implements ArmyActionExecutor {
  constructor(
    private readonly getSession: () => Promise<SessionConfig> | SessionConfig,
    private readonly transport: ActionTransport,
    private readonly pathProvider: PathProvider,
    private readonly armyContext: ArmyWireContextProvider,
  ) {}

  async move(params: MoveArmyParams): Promise<ActionResult> {
    const session = await this.getSession();
    const path = await this.pathProvider.buildMovePath(params);
    const ctx = await this.armyContext.getArmyWireContext(params.armyId);

    const action = buildSignedArmyMoveAction({
      session,
      armyId: params.armyId,
      ownerId: ctx.ownerId,
      units: buildWireUnits(ctx.units),
      path,
      armySize: ctx.armySize,
      forcedMarch: params.forcedMarch,
    });

    return this.transport.send(action);
  }

  async stop(params: StopArmyParams): Promise<ActionResult> {
    return {
      ok: false,
      requestId: -1,
      error: `HTTP stop skeleton not implemented yet (army ${params.armyId})`,
    };
  }

  async attack(params: AttackArmyParams): Promise<ActionResult> {
    if (!params.targetPosition) {
      return {
        ok: false,
        requestId: -1,
        error:
          "HTTP attack needs targetPosition (use BrowserBridgeExecutor for live pathfinding)",
      };
    }
    const session = await this.getSession();
    const path = await this.pathProvider.buildMovePath({
      armyId: params.armyId,
      target: params.targetPosition,
    });
    const ctx = await this.armyContext.getArmyWireContext(params.armyId);
    const action = buildSignedArmyAttackAction({
      session,
      armyId: params.armyId,
      ownerId: ctx.ownerId,
      units: buildWireUnits(ctx.units),
      path,
      armySize: ctx.armySize,
      targetArmyId: params.targetArmyId,
      targetPosition: params.targetPosition,
    });
    return this.transport.send(action);
  }
}
