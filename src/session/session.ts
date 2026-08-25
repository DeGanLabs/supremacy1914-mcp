import type { AuthProvider, SessionConfig } from "../types/auth.js";
import { EnvAuthProvider } from "./auth-provider.js";

export class GameSession {
  private cached: SessionConfig | null = null;

  constructor(private readonly authProvider: AuthProvider = new EnvAuthProvider()) {}

  async getConfig(forceRefresh = false): Promise<SessionConfig> {
    if (!this.cached || forceRefresh) {
      this.cached = await this.authProvider.getSession();
    }
    return this.cached;
  }

  clear(): void {
    this.cached = null;
  }
}
