import type { PlayerId } from "../types/common.js";
import type { DiplomacyMatrixSnapshot, CountryRelation } from "../types/relations.js";
import type { KnownCountryStats } from "../state/relations-reader.js";
import type { SpySnapshotDetailed, SpyDayIntel } from "../types/spy.js";

export class IntelligenceService {
  constructor(
    private readonly loadRelations: () =>
      | Promise<DiplomacyMatrixSnapshot>
      | DiplomacyMatrixSnapshot,
    private readonly loadCountries: (
      onlyPlayerIds?: readonly PlayerId[],
    ) => Promise<KnownCountryStats[]> | KnownCountryStats[],
    private readonly loadSpies: () =>
      | Promise<SpySnapshotDetailed | null>
      | SpySnapshotDetailed
      | null,
  ) {}

  async diplomacy(): Promise<DiplomacyMatrixSnapshot> {
    return this.loadRelations();
  }

  async atWar(): Promise<readonly CountryRelation[]> {
    return (await this.diplomacy()).atWar;
  }

  async countries(onlyPlayerIds?: readonly PlayerId[]): Promise<KnownCountryStats[]> {
    return this.loadCountries(onlyPlayerIds);
  }

  async countryByName(nameOrNation: string): Promise<KnownCountryStats | undefined> {
    const needle = nameOrNation.toLowerCase();
    const all = await this.countries();
    return all.find(
      (c) =>
        c.name.toLowerCase() === needle ||
        c.nationName.toLowerCase() === needle,
    );
  }

  async spies(): Promise<SpySnapshotDetailed | null> {
    return this.loadSpies();
  }

  async latestSpyIntel(): Promise<SpyDayIntel | undefined> {
    const snap = await this.spies();
    return snap?.latestIntel;
  }

  /** Countries visible via latest spy intel (+ their public combat/rank stats). */
  async knownFromSpies(): Promise<KnownCountryStats[]> {
    const intel = await this.latestSpyIntel();
    if (!intel?.knownPlayerIds.length) return [];
    return this.countries(intel.knownPlayerIds);
  }
}
