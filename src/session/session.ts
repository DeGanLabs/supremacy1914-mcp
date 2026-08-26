import type { AuthProvider, SessionConfig } from "../types/auth.js";
import { EnvAuthProvider } from "./auth-provider.js";

export class GameSession {
  private cached: SessionConfig | null = null;
  private cachedAt = 0;
  private readonly ttlMs = 60_000;

  constructor(private readonly authProvider: AuthProvider = new EnvAuthProvider()) {}

  async getConfig(forceRefresh = false): Promise<SessionConfig> {
    if (
      !this.cached ||
      forceRefresh ||
      Date.now() - this.cachedAt > this.ttlMs
    ) {
      this.cached = await this.authProvider.getSession();
      this.cachedAt = Date.now();
    }
    return this.cached;
  }

  clear(): void {
    this.cached = null;
  }
}
