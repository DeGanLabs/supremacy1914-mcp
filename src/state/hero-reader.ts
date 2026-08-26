import type {
  DeployedHeroArmy,
  HeroSnapshot,
  HeroesSnapshot,
} from "../types/hero.js";
import type { PlayerId } from "../types/common.js";

export interface RawHeroItem {
  itemID?: number;
  itemId?: number;
  getItemID?: () => number;
  deploymentMoraleThreshold?: number;
  getHeroConfig?: () => {
    getName?: () => string;
    getShortName?: () => string;
  } | null;
  getCurrentLevel?: () => number;
  getRarity?: () => string;
  isObtained?: () => boolean;
  isDeployed?: () => boolean;
  isHeroDeploymentOnCooldown?: () => boolean;
  isHeroLimitReached?: () => boolean;
  isLocked?: () => boolean;
  getHeroRecoveryCooldown?: () => number;
  getUnitType?: () => { getItemID?: () => number; itemID?: number } | null;
  baseUnitTypeId?: number;
}

export interface RawHeroSystemManager {
  getHeroItems(): RawHeroItem[] | Record<string, RawHeroItem>;
  getMaxHeroLimitForCurrentScenario(): number;
  getDeployedHeroAmountForActiveGame(): number;
  getHeroUnitItemByUnitTypeId?: (unitTypeId: number) => RawHeroItem | null | undefined;
  getHeroByItemId?: (itemId: number) => RawHeroItem | null | undefined;
}

function heroItemId(it: RawHeroItem): number {
  return it.getItemID?.() ?? it.itemID ?? it.itemId ?? 0;
}

export function mapHeroItem(it: RawHeroItem): HeroSnapshot {
  const cfg = it.getHeroConfig?.();
  const ut = it.getUnitType?.();
  const obtained = !!it.isObtained?.();
  const deployed = !!it.isDeployed?.();
  const onCooldown = !!it.isHeroDeploymentOnCooldown?.();
  const locked = !!it.isLocked?.();
  return {
    itemId: heroItemId(it),
    name: cfg?.getName?.() ?? `hero_${heroItemId(it)}`,
    shortName: cfg?.getShortName?.() ?? "",
    level: it.getCurrentLevel?.() ?? 0,
    rarity: it.getRarity?.() ?? null,
    unitTypeId: ut?.getItemID?.() ?? ut?.itemID ?? it.baseUnitTypeId ?? null,
    obtained,
    deployed,
    onCooldown,
    cooldownSeconds: it.getHeroRecoveryCooldown?.() ?? 0,
    limitReached: !!it.isHeroLimitReached?.(),
    locked,
    moraleThreshold: it.deploymentMoraleThreshold,
    canDeploy: obtained && !deployed && !onCooldown && !locked,
  };
}

export function readDeployedHeroArmiesFromHup(hup: {
  config: { userData: { playerID: PlayerId } };
  heroSystemManager: RawHeroSystemManager;
  gameState: {
    getArmyState: () => {
      getArmiesArray: () => Array<{
        getOwnerID(): number;
        getArmyID(): number;
        getPosition(): { x: number; y: number };
        getUnits(): Array<{
          getEffectiveUnitType?: () => { getItemID?: () => number } | null;
        }> | null;
      }>;
    };
    getMapState: () => {
      getProvinceAt: (pos: { x: number; y: number }) => {
        getName?: () => string;
        getLocationID?: () => number;
        locationID?: number;
      } | null;
    };
  };
}): DeployedHeroArmy[] {
  const hsm = hup.heroSystemManager;
  const pid = hup.config.userData.playerID;
  const map = hup.gameState.getMapState();
  return hup.gameState
    .getArmyState()
    .getArmiesArray()
    .filter((a) => a.getOwnerID() === pid)
    .flatMap((a) => {
      const heroes = (a.getUnits() || [])
        .map((u) => {
          const t = u.getEffectiveUnitType?.();
          const typeId = t?.getItemID?.();
          if (typeId == null) return null;
          const hi = hsm.getHeroUnitItemByUnitTypeId?.(typeId);
          if (!hi) return null;
          const mapped = mapHeroItem(hi);
          return {
            unitTypeId: typeId,
            name: mapped.name,
            shortName: mapped.shortName,
            level: mapped.level,
            rarity: mapped.rarity,
            cooldownSeconds: mapped.cooldownSeconds,
          };
        })
        .filter((x) => x != null);
      if (!heroes.length) return [];
      const pos = a.getPosition();
      const prov = map.getProvinceAt(pos);
      const row: DeployedHeroArmy = {
        armyId: a.getArmyID(),
        provinceId: prov?.getLocationID?.() ?? prov?.locationID ?? null,
        provinceName: prov?.getName?.() ?? null,
        pos: { x: pos.x, y: pos.y },
        heroes,
      };
      return [row];
    });
}

export function readHeroesSnapshotFromHup(hup: {
  config: { userData: { playerID: PlayerId } };
  heroSystemManager: RawHeroSystemManager;
  gameState: {
    getArmyState: () => {
      getArmiesArray: () => Array<{
        getOwnerID(): number;
        getArmyID(): number;
        getPosition(): { x: number; y: number };
        getUnits(): Array<{
          getEffectiveUnitType?: () => { getItemID?: () => number } | null;
        }> | null;
      }>;
    };
    getMapState: () => {
      getProvinceAt: (pos: { x: number; y: number }) => {
        getName?: () => string;
        getLocationID?: () => number;
        locationID?: number;
      } | null;
    };
  };
}): HeroesSnapshot {
  const hsm = hup.heroSystemManager;
  const raw = hsm.getHeroItems();
  const items = (Array.isArray(raw) ? raw : Object.values(raw || {})).map(mapHeroItem);
  const obtained = items.filter((h) => h.obtained);
  return {
    maxDeployed: hsm.getMaxHeroLimitForCurrentScenario(),
    deployedCount: hsm.getDeployedHeroAmountForActiveGame(),
    inventory: obtained,
    deployed: obtained.filter((h) => h.deployed),
    deployable: obtained.filter((h) => h.canDeploy),
    onCooldown: obtained.filter((h) => h.onCooldown),
    deployedOnMap: readDeployedHeroArmiesFromHup(hup),
  };
}
