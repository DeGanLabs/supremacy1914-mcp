import type {
  ArmyCommandKind,
  ArmyCommandView,
  ArmySnapshot,
  UnitStack,
} from "../types/army.js";
import type { PlayerId, Vec2 } from "../types/common.js";

export interface RawBrowserArmy {
  getArmyID(): number;
  getOwnerID(): number;
  getLocationID(): number;
  getPosition(): Vec2;
  isOnSea(): boolean;
  getUnits(): RawBrowserUnit[] | null | undefined;
  getCommands(): RawBrowserCommand[] | null | undefined;
}

export interface RawBrowserUnit {
  getTypeID?: () => number;
  getSize?: () => number;
  getMorale?: () => number;
  getEffectiveUnitType?: () => { getName?: () => string } | null;
}

export interface RawBrowserCommand {
  constructor?: { name?: string };
  getCommandIconName?: () => string;
  getStartPos?: () => Vec2;
  getTargetPos?: () => Vec2;
  waitSeconds?: number;
  targetUnitID?: number;
  targetPos?: Vec2;
  "@c"?: string;
}

export interface RawMapState {
  getProvinceAt(pos: Vec2): {
    getName?: () => string;
    getOwnerID?: () => number;
  } | null;
}

function mapCommandKind(cmd: RawBrowserCommand): ArmyCommandKind {
  const wire = cmd["@c"] ?? "";
  const icon = cmd.getCommandIconName?.() ?? "";
  const ctor = cmd.constructor?.name ?? "";
  if (wire === "gc" || icon === "march" || ctor.includes("Goto")) return "goto";
  if (wire === "dwc") return "delay";
  if (wire === "wc" || icon === "wait" || ctor.includes("Wait")) return "wait";
  if (wire === "ac" || icon.includes("attack") || ctor.includes("Attack")) {
    return "attack";
  }
  if (wire === "pc" || icon.includes("patrol") || ctor.includes("Patrol")) {
    return "patrol";
  }
  return "unknown";
}

export function mapUnit(unit: RawBrowserUnit): UnitStack {
  const type = unit.getEffectiveUnitType?.();
  return {
    typeId: unit.getTypeID?.() ?? -1,
    size: unit.getSize?.() ?? 0,
    name: type?.getName?.(),
    morale: unit.getMorale?.(),
  };
}

export function mapCommand(cmd: RawBrowserCommand): ArmyCommandView {
  return {
    kind: mapCommandKind(cmd),
    start: cmd.getStartPos?.(),
    target: cmd.targetPos ?? cmd.getTargetPos?.(),
    waitSeconds: cmd.waitSeconds,
    targetArmyId: cmd.targetUnitID,
    rawClass: cmd.constructor?.name,
    wireClass: cmd["@c"],
  };
}

export function mapArmy(
  army: RawBrowserArmy,
  map?: RawMapState,
): ArmySnapshot {
  const position = army.getPosition();
  const province = map?.getProvinceAt(position) ?? null;
  const units = (army.getUnits() ?? []).map(mapUnit);
  const commands = (army.getCommands() ?? []).map(mapCommand);

  return {
    id: army.getArmyID(),
    ownerId: army.getOwnerID() as PlayerId,
    locationId: army.getLocationID(),
    position: { x: position.x, y: position.y },
    onSea: army.isOnSea(),
    provinceName: province?.getName?.(),
    provinceOwnerId: province?.getOwnerID?.(),
    units,
    commands,
  };
}

export function readOwnArmiesFromHup(hup: {
  config: { userData: { playerID: number } };
  gameState: {
    getArmyState(): {
      getArmiesArray(): RawBrowserArmy[];
    };
    getMapState(): RawMapState;
  };
}): ArmySnapshot[] {
  const playerId = hup.config.userData.playerID;
  const map = hup.gameState.getMapState();
  return hup.gameState
    .getArmyState()
    .getArmiesArray()
    .filter((a) => a.getOwnerID() === playerId)
    .map((a) => mapArmy(a, map));
}
