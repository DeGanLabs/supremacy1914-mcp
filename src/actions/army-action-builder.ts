import type { SessionConfig } from "../types/auth.js";
import type {
  GotoSegment,
  SignedActionEnvelope,
  WireArmy,
  WireArmyAction,
  WireArmyCommand,
  WireAttackCommand,
  WireDelayWaitCommand,
  WireGotoCommand,
  WireUnit,
  WireUpdateGameStateAction,
} from "../types/actions.js";
import { ActionClass, WaitDirection } from "../types/actions.js";
import type { ArmyId, PlayerId, Vec2 } from "../types/common.js";
import { createLocalRequestId, createNumericRequestId } from "../utils/ids.js";
import { toWirePoint } from "../utils/geo.js";

export interface BuildArmyMoveActionInput {
  readonly session: SessionConfig;
  readonly armyId: ArmyId;
  readonly ownerId: PlayerId;
  readonly units: readonly WireUnit[];
  readonly path: readonly GotoSegment[];
  readonly armySize?: number;
  readonly aggression?: number;
  readonly forcedMarch?: boolean;
  readonly airUnit?: number;
  readonly lastCallDurationMs?: number;
  readonly stateIDs?: Record<string, string | number>;
  readonly tstamps?: Record<string, string>;
  readonly outerRequestId?: number;
  readonly innerRequestId?: string;
}

export interface BuildArmyAttackActionInput extends BuildArmyMoveActionInput {
  readonly targetArmyId: ArmyId;
  readonly targetPosition: Vec2;
  /** Extra commands after path (usually empty; path already includes approach). */
  readonly trailingCommands?: readonly WireArmyCommand[];
}

export interface BuildArmyDelayActionInput {
  readonly session: SessionConfig;
  readonly armyId: ArmyId;
  readonly ownerId: PlayerId;
  readonly units: readonly WireUnit[];
  readonly waitSeconds: number;
  readonly position?: Vec2;
  readonly existingCommands?: readonly WireArmyCommand[];
  readonly armySize?: number;
  readonly aggression?: number;
  readonly forcedMarch?: boolean;
  readonly airUnit?: number;
  readonly lastCallDurationMs?: number;
  readonly stateIDs?: Record<string, string | number>;
  readonly tstamps?: Record<string, string>;
  readonly outerRequestId?: number;
  readonly innerRequestId?: string;
}

export interface BuildArmyFlagsActionInput {
  readonly session: SessionConfig;
  readonly armyId: ArmyId;
  readonly ownerId: PlayerId;
  readonly units: readonly WireUnit[];
  readonly commands?: readonly WireArmyCommand[];
  readonly armySize?: number;
  readonly aggression?: number;
  readonly forcedMarch?: boolean;
  readonly airUnit?: number;
  readonly lastCallDurationMs?: number;
  readonly stateIDs?: Record<string, string | number>;
  readonly tstamps?: Record<string, string>;
  readonly outerRequestId?: number;
  readonly innerRequestId?: string;
}

export function buildGotoCommand(start: Vec2, target: Vec2): WireGotoCommand {
  return {
    "@c": ActionClass.GotoCommand,
    sp: toWirePoint(start),
    tp: toWirePoint(target),
  };
}

export function buildAttackCommand(
  targetArmyId: ArmyId,
  targetPosition: Vec2,
): WireAttackCommand {
  return {
    "@c": ActionClass.AttackCommand,
    targetUnitID: targetArmyId,
    targetPos: toWirePoint(targetPosition),
  };
}

/**
 * UI Delay command. `waitSeconds` is game-time seconds
 * (client: `floor(60 * minutes / timeScale)`).
 */
export function buildDelayWaitCommand(
  waitSeconds: number,
  options?: {
    readonly position?: Vec2;
    readonly execTime?: number;
    readonly cancelable?: boolean;
  },
): WireDelayWaitCommand {
  if (waitSeconds <= 0) {
    throw new Error("waitSeconds must be > 0");
  }
  return {
    "@c": ActionClass.DelayWaitCommand,
    waitSeconds,
    cancelable: options?.cancelable ?? true,
    direction: WaitDirection.Delay,
    locationID: -1,
    execTime: options?.execTime ?? 0,
    ...(options?.position
      ? { targetPos: toWirePoint(options.position) }
      : {}),
  };
}

export function buildWireUnits(
  units: readonly { typeId: number; size: number }[],
): WireUnit[] {
  return units.map((u) => ({
    "@c": ActionClass.Unit,
    t: u.typeId,
    s: u.size,
  }));
}

function buildWireArmyBase(input: {
  readonly armyId: ArmyId;
  readonly ownerId: PlayerId;
  readonly units: readonly WireUnit[];
  readonly commands: WireArmyCommand[];
  readonly armySize?: number;
  readonly aggression?: number;
  readonly forcedMarch?: boolean;
  readonly airUnit?: number;
}): WireArmy {
  return {
    "@c": ActionClass.Army,
    id: input.armyId,
    s: input.armySize ?? 1,
    o: input.ownerId,
    u: [...input.units],
    c: input.commands,
    au: input.airUnit ?? 0,
    ag: input.aggression ?? 0,
    fm: input.forcedMarch ? 1 : 0,
  };
}

export function buildWireArmyMove(input: BuildArmyMoveActionInput): WireArmy {
  if (input.path.length === 0) {
    throw new Error("path must contain at least one goto segment");
  }

  return buildWireArmyBase({
    ...input,
    commands: input.path.map((seg) => buildGotoCommand(seg.start, seg.target)),
  });
}

export function buildWireArmyAttack(input: BuildArmyAttackActionInput): WireArmy {
  if (input.path.length === 0) {
    throw new Error(
      "attack path must contain at least one goto segment (or approach)",
    );
  }
  const commands: WireArmyCommand[] = [
    ...input.path.map((seg) => buildGotoCommand(seg.start, seg.target)),
    ...(input.trailingCommands ?? []),
    buildAttackCommand(input.targetArmyId, input.targetPosition),
  ];
  return buildWireArmyBase({ ...input, commands });
}

export function buildWireArmyDelay(input: BuildArmyDelayActionInput): WireArmy {
  const existing = [...(input.existingCommands ?? [])];
  const delay = buildDelayWaitCommand(input.waitSeconds, {
    position: input.position,
  });
  // Client unshifts delay after preserving a leading special wait if present.
  const commands: WireArmyCommand[] = [delay, ...existing];
  return buildWireArmyBase({ ...input, commands });
}

export function buildWireArmyFlags(input: BuildArmyFlagsActionInput): WireArmy {
  return buildWireArmyBase({
    ...input,
    commands: [...(input.commands ?? [])],
  });
}

export function buildArmyAction(
  army: WireArmy,
  innerRequestId = createLocalRequestId(),
): WireArmyAction {
  return {
    requestID: innerRequestId,
    "@c": ActionClass.ArmyAction,
    armies: [army],
  };
}

/**
 * Wraps sub-actions the same way `wrapIntoUpdateGameStateAction` + `signMessage` do.
 */
export function signUpdateGameStateAction(
  session: SessionConfig,
  actions: unknown[],
  options?: {
    readonly requestId?: number;
    readonly lastCallDurationMs?: number;
    readonly stateIDs?: Record<string, string | number>;
    readonly tstamps?: Record<string, string>;
  },
): SignedActionEnvelope {
  const envelope: WireUpdateGameStateAction = {
    requestID: options?.requestId ?? createNumericRequestId(),
    "@c": ActionClass.UpdateGameState,
    actions,
    lastCallDuration: options?.lastCallDurationMs ?? 0,
    stateIDs: options?.stateIDs,
    tstamps: options?.tstamps,
    version: session.version,
    client: session.client,
    siteUserID: session.siteUserID,
    adminLevel: session.adminLevel,
    gameID: session.gameID,
    playerID: session.playerID,
    rights: session.rights,
    userAuth: session.userAuth,
    tstamp: session.tstamp,
  };
  return envelope;
}

function signArmy(
  input: {
    readonly session: SessionConfig;
    readonly lastCallDurationMs?: number;
    readonly stateIDs?: Record<string, string | number>;
    readonly tstamps?: Record<string, string>;
    readonly outerRequestId?: number;
    readonly innerRequestId?: string;
  },
  army: WireArmy,
): SignedActionEnvelope {
  const armyAction = buildArmyAction(army, input.innerRequestId);
  return signUpdateGameStateAction(input.session, [armyAction], {
    requestId: input.outerRequestId,
    lastCallDurationMs: input.lastCallDurationMs,
    stateIDs: input.stateIDs,
    tstamps: input.tstamps,
  });
}

export function buildSignedArmyMoveAction(
  input: BuildArmyMoveActionInput,
): SignedActionEnvelope {
  return signArmy(input, buildWireArmyMove(input));
}

/** Path + terminal `@c:"ac"` attack (melee or bombard — same wire). */
export function buildSignedArmyAttackAction(
  input: BuildArmyAttackActionInput,
): SignedActionEnvelope {
  return signArmy(input, buildWireArmyAttack(input));
}

/** Prefixed `@c:"dwc"` delay wait. Prefer browser path for correct timeScale math. */
export function buildSignedArmyDelayAction(
  input: BuildArmyDelayActionInput,
): SignedActionEnvelope {
  return signArmy(input, buildWireArmyDelay(input));
}

/** Update `fm` / `ag` flags (forced march / aggressiveness) with current commands. */
export function buildSignedArmyFlagsAction(
  input: BuildArmyFlagsActionInput,
): SignedActionEnvelope {
  return signArmy(input, buildWireArmyFlags(input));
}

/** Game-time seconds for UI delay minutes: `floor(60 * minutes / timeScale)`. */
export function delayMinutesToGameSeconds(
  minutes: number,
  timeScale: number,
): number {
  if (minutes <= 0) throw new Error("minutes must be > 0");
  if (!(timeScale > 0)) throw new Error("timeScale must be > 0");
  return Math.floor((60 * minutes) / timeScale);
}
