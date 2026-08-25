import type { PlayerId } from "../types/common.js";
import type {
  FullStatsSnapshot,
  GameInfoSnapshot,
  PlayerCombatStats,
  ProvincesSnapshot,
  RankingEntry,
} from "../types/stats.js";

export class StatsService {
  constructor(
    private readonly load: () => Promise<FullStatsSnapshot> | FullStatsSnapshot,
  ) {}

  async snapshot(): Promise<FullStatsSnapshot> {
    return this.load();
  }

  async gameInfo(): Promise<GameInfoSnapshot> {
    return (await this.snapshot()).gameInfo;
  }

  async combat(playerId?: PlayerId): Promise<PlayerCombatStats> {
    const snap = await this.snapshot();
    if (playerId === undefined || playerId === snap.selfPlayerId) {
      return snap.combat;
    }
    // Full cross-player combat needs live stats state; expose self by default.
    throw new Error(
      "combat(otherPlayerId) requires a dedicated reader hook — use readPlayerCombatStats(state, id)",
    );
  }

  async ranking(): Promise<readonly RankingEntry[]> {
    return (await this.snapshot()).ranking;
  }

  async provinces(): Promise<ProvincesSnapshot> {
    return (await this.snapshot()).provinces;
  }

  async topPlayers(limit = 10): Promise<RankingEntry[]> {
    return (await this.ranking()).slice(0, limit);
  }

  async findRankByName(nameOrNation: string): Promise<RankingEntry | undefined> {
    const needle = nameOrNation.toLowerCase();
    const ranking = await this.ranking();
    return ranking.find(
      (r) =>
        r.name.toLowerCase() === needle ||
        r.nationName.toLowerCase() === needle,
    );
  }
}
