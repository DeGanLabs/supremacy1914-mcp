import type { EconomySnapshot, ResourceSnapshot } from "../types/index.js";

export class ResourceService {
  constructor(
    private readonly load: () => Promise<EconomySnapshot> | EconomySnapshot,
  ) {}

  async snapshot(): Promise<EconomySnapshot> {
    return this.load();
  }

  async getByName(name: string): Promise<ResourceSnapshot | undefined> {
    const snap = await this.snapshot();
    return snap.byName[name.toLowerCase()];
  }

  async criticalResources(): Promise<ResourceSnapshot[]> {
    const snap = await this.snapshot();
    return snap.resources.filter((r) => r.isCritical || r.rate < 0);
  }
}
