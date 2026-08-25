import type { GameSnapshot } from "../types/game.js";
import type { PlayerId } from "../types/common.js";
import type { CommunicationsSnapshot } from "../types/messages.js";
import type { FullStatsSnapshot } from "../types/stats.js";
import type { DiplomacyMatrixSnapshot } from "../types/relations.js";
import type { KnownCountryStats } from "../state/relations-reader.js";
import type { SpySnapshotDetailed } from "../types/spy.js";
import { ArmyService } from "./army-service.js";
import { DiplomacyService } from "./diplomacy-service.js";
import { ResourceService } from "./resource-service.js";
import { MessageService, type RelatedCommunications } from "./message-service.js";
import { StatsService } from "./stats-service.js";
import { IntelligenceService } from "./intelligence-service.js";
import type { ArmyActionExecutor } from "../transport/executor.js";

export interface GameServiceDeps {
  readonly readSnapshot: () => Promise<GameSnapshot> | GameSnapshot;
  readonly armyExecutor: ArmyActionExecutor;
  readonly readCommunications?: () =>
    | Promise<CommunicationsSnapshot>
    | CommunicationsSnapshot;
  readonly readRelatedWith?: (
    otherPlayerId: PlayerId,
  ) => Promise<RelatedCommunications> | RelatedCommunications;
  readonly readStats?: () => Promise<FullStatsSnapshot> | FullStatsSnapshot;
  readonly readDiplomacyMatrix?: () =>
    | Promise<DiplomacyMatrixSnapshot>
    | DiplomacyMatrixSnapshot;
  readonly readKnownCountries?: (
    onlyPlayerIds?: readonly PlayerId[],
  ) => Promise<KnownCountryStats[]> | KnownCountryStats[];
  readonly readSpies?: () =>
    | Promise<SpySnapshotDetailed | null>
    | SpySnapshotDetailed
    | null;
}

export class GameService {
  readonly armies: ArmyService;
  readonly diplomacy: DiplomacyService;
  readonly resources: ResourceService;
  readonly messages: MessageService;
  readonly stats: StatsService;
  readonly intel: IntelligenceService;

  constructor(private readonly deps: GameServiceDeps) {
    this.armies = new ArmyService(deps.armyExecutor, async () => {
      const snap = await deps.readSnapshot();
      return snap.armies;
    });
    this.diplomacy = new DiplomacyService(async () => {
      const snap = await deps.readSnapshot();
      return snap.diplomacy;
    });
    this.resources = new ResourceService(async () => {
      const snap = await deps.readSnapshot();
      return snap.economy;
    });
    this.messages = new MessageService(
      async () => {
        if (deps.readCommunications) return deps.readCommunications();
        const snap = await deps.readSnapshot();
        if (!snap.communications) {
          throw new Error("Communications not loaded");
        }
        return snap.communications;
      },
      deps.readRelatedWith,
    );
    this.stats = new StatsService(async () => {
      if (deps.readStats) return deps.readStats();
      const snap = await deps.readSnapshot();
      if (!snap.stats) throw new Error("Stats not loaded");
      return snap.stats;
    });
    this.intel = new IntelligenceService(
      () => {
        if (!deps.readDiplomacyMatrix) throw new Error("readDiplomacyMatrix missing");
        return deps.readDiplomacyMatrix();
      },
      (only) => {
        if (!deps.readKnownCountries) throw new Error("readKnownCountries missing");
        return deps.readKnownCountries(only);
      },
      () => {
        if (!deps.readSpies) throw new Error("readSpies missing");
        return deps.readSpies();
      },
    );
  }

  async snapshot(): Promise<GameSnapshot> {
    return this.deps.readSnapshot();
  }
}
