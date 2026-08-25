import type {
  ProvinceMapView,
  VisibleArmyView,
  WorldViewSnapshot,
} from "../types/world.js";
import type { PlayerId, Vec2 } from "../types/common.js";
import type { UnitStack } from "../types/army.js";

export interface RawWorldArmy {
  getArmyID(): number;
  getOwnerID(): number;
  getLocationID(): number;
  getPosition(): Vec2;
  isOnSea(): boolean;
  getUnits(): Array<{
    getTypeID?: () => number;
    getSize?: () => number;
    getMorale?: () => number;
    getEffectiveUnitType?: () => { getName?: () => string; getItemID?: () => number } | null;
  }> | null;
  getCommands?: () => unknown[] | null;
  isDetailsVisible?: () => boolean;
  getVisibleUnits?: () => unknown[] | null;
  getVisibleMorale?: () => number;
  getSpyRevealedTime?: () => number;
  morale?: number;
}

export interface RawWorldProvince {
  getLocationID(): number;
  getName(): string;
  getOwnerID(): number;
  getMorale?: () => number;
  isCoastal?: () => boolean;
  coastal?: boolean;
  getUnknownUpgradesCount?: () => number;
  getVisibleUpgrades?: () => unknown[] | null;
  getStationaryArmyID?: () => number;
  getCapital?: () => Vec2 | null;
  capital?: Vec2 | null;
}

export interface RawWorldPlayer {
  getPlayerID(): number;
  getName?: () => string;
  getNationName?: () => string;
  isDefeated?: () => boolean;
}

export interface ReadWorldViewOptions {
  /** Include every province (default true). */
  readonly includeProvinces?: boolean;
  /** Include armies (default true). */
  readonly includeArmies?: boolean;
  /** Only armies from getVisibleArmies() (default false = all known client armies). */
  readonly onlyVisibleArmies?: boolean;
  /** Filter to one owner. */
  readonly ownerId?: PlayerId;
  /** Omit own armies/provinces. */
  readonly excludeSelf?: boolean;
}

function mapUnit(u: {
  getTypeID?: () => number;
  getSize?: () => number;
  getMorale?: () => number;
  getEffectiveUnitType?: () => { getName?: () => string; getItemID?: () => number } | null;
}): UnitStack {
  const t = u.getEffectiveUnitType?.();
  return {
    typeId: u.getTypeID?.() ?? t?.getItemID?.() ?? -1,
    size: u.getSize?.() ?? 0,
    name: t?.getName?.(),
    morale: u.getMorale?.(),
  };
}

function playerRef(
  players: Map<number, RawWorldPlayer>,
  id: number,
): { name: string | null; nation: string | null } {
  const p = players.get(id);
  return {
    name: p?.getName?.() ?? null,
    nation: p?.getNationName?.() ?? null,
  };
}

export function mapVisibleArmy(
  army: RawWorldArmy,
  players: Map<number, RawWorldPlayer>,
  map: {
    getProvinceAt(pos: Vec2): { getName?: () => string } | null;
  },
): VisibleArmyView {
  const pos = army.getPosition();
  const prov = map.getProvinceAt(pos);
  const detailsVisible = army.isDetailsVisible?.() ?? true;
  const units = detailsVisible ? (army.getUnits() ?? []).map(mapUnit) : [];
  const ownerId = army.getOwnerID() as PlayerId;
  const ref = playerRef(players, ownerId);
  return {
    id: army.getArmyID(),
    ownerId,
    ownerName: ref.name,
    nation: ref.nation,
    locationId: army.getLocationID(),
    position: { x: pos.x, y: pos.y },
    provinceName: prov?.getName?.() ?? null,
    onSea: army.isOnSea(),
    detailsVisible,
    units,
    morale: army.getVisibleMorale?.() ?? army.morale ?? null,
    spyRevealedTime: army.getSpyRevealedTime?.() ?? null,
    commandCount: (army.getCommands?.() ?? []).length,
  };
}

export function mapProvinceView(
  p: RawWorldProvince,
  players: Map<number, RawWorldPlayer>,
): ProvinceMapView {
  const ownerId = p.getOwnerID() as PlayerId;
  const ref = playerRef(players, ownerId);
  const capital = p.getCapital?.() ?? p.capital ?? null;
  return {
    id: p.getLocationID(),
    name: p.getName(),
    ownerId,
    ownerName: ref.name,
    nation: ref.nation,
    morale: p.getMorale?.() ?? null,
    coastal: p.isCoastal?.() ?? !!p.coastal,
    unknownUpgradeCount: p.getUnknownUpgradesCount?.() ?? 0,
    visibleUpgradeCount: (p.getVisibleUpgrades?.() ?? []).length,
    stationaryArmyId: p.getStationaryArmyID?.() ?? null,
    capital: capital ? { x: capital.x, y: capital.y } : null,
  };
}

export function readWorldViewFromHup(
  hup: {
    config: { userData: { playerID: PlayerId } };
    gameState: {
      getArmyState(): {
        getArmiesArray(): RawWorldArmy[];
        getVisibleArmies?: () => RawWorldArmy[];
      };
      getMapState(): {
        getWidth?: () => number;
        getHeight?: () => number;
        getProvinceArray(): RawWorldProvince[];
        getProvinceAt(pos: Vec2): { getName?: () => string } | null;
      };
      getPlayerState(): {
        getPlayersArray(): RawWorldPlayer[];
        getPlayer(id: number): RawWorldPlayer | null;
      };
      getForeignAffairsState?: () => {
        getRelations(): { getRelation(a: number, b: number): number };
      };
    };
  },
  options: ReadWorldViewOptions = {},
): WorldViewSnapshot {
  const self = hup.config.userData.playerID;
  const map = hup.gameState.getMapState();
  const armyState = hup.gameState.getArmyState();
  const playerArr = hup.gameState.getPlayerState().getPlayersArray();
  const players = new Map(playerArr.map((p) => [p.getPlayerID(), p]));

  const includeProvinces = options.includeProvinces !== false;
  const includeArmies = options.includeArmies !== false;

  let rawArmies: RawWorldArmy[] = [];
  if (includeArmies) {
    rawArmies = options.onlyVisibleArmies
      ? armyState.getVisibleArmies?.() ?? armyState.getArmiesArray()
      : armyState.getArmiesArray();
  }

  let armies = rawArmies.map((a) => mapVisibleArmy(a, players, map));
  if (options.ownerId != null) {
    armies = armies.filter((a) => a.ownerId === options.ownerId);
  }
  if (options.excludeSelf) {
    armies = armies.filter((a) => a.ownerId !== self);
  }

  let provinces: ProvinceMapView[] = [];
  if (includeProvinces) {
    provinces = (map.getProvinceArray() || [])
      .filter((p) => {
        const o = p.getOwnerID();
        if (options.ownerId != null && o !== options.ownerId) return false;
        if (options.excludeSelf && o === self) return false;
        return true;
      })
      .map((p) => mapProvinceView(p, players));
  }

  const rel = hup.gameState.getForeignAffairsState?.()?.getRelations();
  type CountryAcc = {
    playerId: number;
    name: string | null;
    nation: string | null;
    provinceCount: number;
    armyCount: number;
    armiesWithDetails: number;
    armiesFogged: number;
    relationFromSelf: number | null;
  };
  const byCountry = new Map<number, CountryAcc>();

  for (const p of provinces) {
    if (p.ownerId <= 0) continue;
    const cur = byCountry.get(p.ownerId) ?? {
      playerId: p.ownerId,
      name: p.ownerName,
      nation: p.nation,
      provinceCount: 0,
      armyCount: 0,
      armiesWithDetails: 0,
      armiesFogged: 0,
      relationFromSelf:
        p.ownerId === self ? null : (rel?.getRelation(self, p.ownerId) ?? null),
    };
    cur.provinceCount += 1;
    byCountry.set(p.ownerId, cur);
  }

  for (const a of armies) {
    if (a.ownerId <= 0) continue;
    const cur = byCountry.get(a.ownerId) ?? {
      playerId: a.ownerId,
      name: a.ownerName,
      nation: a.nation,
      provinceCount: 0,
      armyCount: 0,
      armiesWithDetails: 0,
      armiesFogged: 0,
      relationFromSelf:
        a.ownerId === self ? null : (rel?.getRelation(self, a.ownerId) ?? null),
    };
    cur.armyCount += 1;
    if (a.detailsVisible) cur.armiesWithDetails += 1;
    else cur.armiesFogged += 1;
    byCountry.set(a.ownerId, cur);
  }

  const countries = [...byCountry.values()].sort(
    (a, b) => b.provinceCount - a.provinceCount || b.armyCount - a.armyCount,
  );

  return {
    selfPlayerId: self,
    mapSize: {
      width: map.getWidth?.() ?? 0,
      height: map.getHeight?.() ?? 0,
    },
    provinceCount: provinces.length,
    armyCount: armies.length,
    visibleArmyCount: (armyState.getVisibleArmies?.() ?? []).length,
    countries,
    provinces,
    armies,
  };
}
