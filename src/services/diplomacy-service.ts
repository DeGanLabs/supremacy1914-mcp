import type { DiplomacySnapshot, DiplomacyEdge, PlayerSnapshot } from "../types/index.js";

export class DiplomacyService {
  constructor(
    private readonly load: () => Promise<DiplomacySnapshot> | DiplomacySnapshot,
  ) {}

  async snapshot(): Promise<DiplomacySnapshot> {
    return this.load();
  }

  async enemies(): Promise<DiplomacyEdge[]> {
    const snap = await this.snapshot();
    return snap.edges.filter((e) => e.atWar);
  }

  async rightOfWayPartners(): Promise<DiplomacyEdge[]> {
    const snap = await this.snapshot();
    return snap.edges.filter((e) => e.hasRightOfWay);
  }

  async findPlayerByNation(nationName: string): Promise<PlayerSnapshot | undefined> {
    const snap = await this.snapshot();
    const needle = nationName.toLowerCase();
    return snap.players.find((p) => p.nationName.toLowerCase() === needle);
  }

  async findPlayerByName(name: string): Promise<PlayerSnapshot | undefined> {
    const snap = await this.snapshot();
    const needle = name.toLowerCase();
    return snap.players.find((p) => p.name.toLowerCase() === needle);
  }
}
