import type { PlayerId } from "../types/common.js";
import type {
  SpyAgent,
  SpyDayIntel,
  SpyJobResult,
  SpyKnownArmy,
  SpyKnownProvince,
  SpySnapshotDetailed,
} from "../types/spy.js";

export interface RawSpyAgent {
  unitUID: number;
  morale: number;
  size: number;
  kills: number;
  onSea: boolean;
  atAirfield: boolean;
  provinceOwner?: number;
  getMissionType(): number;
  getOwnerID(): number;
  getLocationID(): number;
  getDailyCosts(): number;
}

export interface RawSpyJob {
  getDay(): number;
  getTime(): number;
  getName(): string;
  getJobName(): string;
  getDescription(): string;
  getMission(): number;
  getSpyOwnerID(): number;
  getOpponentID(): number;
  getProvinceID(): number;
  getAmount(): number;
  isPremium(): boolean;
  isCountryWide(): boolean;
}

export interface RawDetailedSpyState {
  playerID?: number;
  getPlayerIDs(): number[];
  getSpyJobs(): RawSpyJob[] | Record<string, RawSpyJob>;
  getArmyState(): {
    getArmiesArray(): {
      getArmyID(): number;
      getOwnerID(): number;
      getLocationID(): number;
      getUnits(): {
        getSize?: () => number;
        getEffectiveUnitType?: () => { getName?: () => string } | null;
      }[];
    }[];
  } | null;
  getPlayerProvinces(playerId: number): {
    getName?: () => string;
    getProvinceID?: () => number;
  }[];
}

export interface RawSpyReport {
  currentDay: number;
  dailyStates: Record<string, { day?: number; detailedStates?: unknown }>;
  getDetailedSpyState(day: number): RawDetailedSpyState | null;
  getDailyState?(day: number): { day?: number; detailedStates?: unknown } | null;
}

export interface RawSpyState {
  getSpies(): RawSpyAgent[] | Record<string, RawSpyAgent>;
  getSpyReport(): RawSpyReport | null;
  getNumAllSpies(): number;
  getNumOfIdleSpies(): number;
  getNumSpiesOnMission(): number;
  getDailyCosts(): number;
  getDailyCostsOnMission(): number;
  getNameForMission(missionType: number): string;
}

export interface RawMapForSpy {
  getProvince?(id: number): { getName?: () => string } | null;
  getProvinceArray?: () => { getProvinceID?: () => number; getName?: () => string }[];
}

function asArray<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
}

function resolveProvinceName(map: RawMapForSpy | undefined, locationId: number): string | undefined {
  if (!map) return undefined;
  try {
    const direct = map.getProvince?.(locationId);
    const name = direct?.getName?.();
    if (name) return name;
  } catch {
    // ignore
  }
  try {
    const hit = map.getProvinceArray?.().find((p) => p.getProvinceID?.() === locationId);
    return hit?.getName?.();
  } catch {
    return undefined;
  }
}

export function mapSpyAgent(
  agent: RawSpyAgent,
  spyState: RawSpyState,
  map?: RawMapForSpy,
): SpyAgent {
  const locationId = agent.getLocationID();
  return {
    unitUid: agent.unitUID,
    ownerId: agent.getOwnerID(),
    locationId,
    provinceName: resolveProvinceName(map, locationId),
    provinceOwnerId: agent.provinceOwner,
    missionType: agent.getMissionType(),
    missionName: spyState.getNameForMission(agent.getMissionType()) || `mission_${agent.getMissionType()}`,
    morale: agent.morale,
    size: agent.size,
    kills: agent.kills,
    dailyCosts: agent.getDailyCosts(),
    onSea: Boolean(agent.onSea),
    atAirfield: Boolean(agent.atAirfield),
  };
}

export function mapSpyJob(job: RawSpyJob): SpyJobResult {
  return {
    day: job.getDay(),
    time: job.getTime(),
    name: job.getName(),
    jobName: job.getJobName(),
    description: job.getDescription(),
    mission: job.getMission(),
    spyOwnerId: job.getSpyOwnerID(),
    opponentId: job.getOpponentID(),
    provinceId: job.getProvinceID(),
    amount: job.getAmount(),
    premium: job.isPremium(),
    countryWide: job.isCountryWide(),
  };
}

export function readSpyDayIntel(detailed: RawDetailedSpyState, day: number): SpyDayIntel {
  const knownPlayerIds = (detailed.getPlayerIDs?.() ?? []) as PlayerId[];
  const jobs = asArray(detailed.getSpyJobs()).map(mapSpyJob);

  let knownArmies: SpyKnownArmy[] = [];
  try {
    const armies = detailed.getArmyState()?.getArmiesArray?.() ?? [];
    knownArmies = armies.map((a) => ({
      armyId: a.getArmyID(),
      ownerId: a.getOwnerID(),
      locationId: a.getLocationID(),
      units: (a.getUnits() ?? []).map((u) => ({
        name: u.getEffectiveUnitType?.()?.getName?.(),
        size: u.getSize?.() ?? 0,
      })),
    }));
  } catch {
    knownArmies = [];
  }

  const provincesByPlayer: Record<string, SpyKnownProvince[]> = {};
  for (const playerId of knownPlayerIds) {
    try {
      const list = detailed.getPlayerProvinces(playerId) ?? [];
      provincesByPlayer[String(playerId)] = list.map((p) => ({
        name: p.getName?.(),
        provinceId: p.getProvinceID?.(),
      }));
    } catch {
      provincesByPlayer[String(playerId)] = [];
    }
  }

  return {
    day,
    knownPlayerIds,
    jobs,
    knownArmies,
    provincesByPlayer,
  };
}

export function readSpySnapshot(
  spyState: RawSpyState,
  options?: {
    readonly map?: RawMapForSpy;
    /** Days to materialize intel for. Default: current day only. */
    readonly days?: readonly number[];
    readonly includeAllDays?: boolean;
  },
): SpySnapshotDetailed {
  const report = spyState.getSpyReport();
  const currentDay = report?.currentDay ?? 0;
  const availableDays = report
    ? Object.keys(report.dailyStates ?? {})
        .map(Number)
        .sort((a, b) => a - b)
    : [];

  const daysToRead = options?.includeAllDays
    ? availableDays
    : options?.days ?? (availableDays.includes(currentDay) ? [currentDay] : availableDays.slice(-1));

  const intelByDay: SpyDayIntel[] = [];
  for (const day of daysToRead) {
    try {
      const detailed = report?.getDetailedSpyState(day);
      if (detailed) intelByDay.push(readSpyDayIntel(detailed, day));
    } catch {
      // day may not have detailed state
    }
  }

  return {
    totals: {
      all: spyState.getNumAllSpies(),
      idle: spyState.getNumOfIdleSpies(),
      onMission: spyState.getNumSpiesOnMission(),
      dailyCosts: spyState.getDailyCosts(),
      dailyCostsOnMission: spyState.getDailyCostsOnMission(),
    },
    agents: asArray(spyState.getSpies()).map((a) =>
      mapSpyAgent(a, spyState, options?.map),
    ),
    currentDay,
    availableDays,
    latestIntel: intelByDay[intelByDay.length - 1],
    intelByDay,
  };
}

export function readSpySnapshotFromHup(hup: {
  gameState: {
    getSpyState(): RawSpyState | null;
    getMapState(): RawMapForSpy;
  };
}, options?: { readonly includeAllDays?: boolean; readonly days?: readonly number[] }): SpySnapshotDetailed | null {
  const spy = hup.gameState.getSpyState();
  if (!spy) return null;
  return readSpySnapshot(spy, {
    map: hup.gameState.getMapState(),
    includeAllDays: options?.includeAllDays,
    days: options?.days,
  });
}
