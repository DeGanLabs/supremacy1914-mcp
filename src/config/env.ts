import type { SessionConfig } from "../types/auth.js";

export interface AppConfig {
  readonly session: SessionConfig;
  readonly defaults: {
    readonly requestTimeoutMs: number;
    readonly maxRetries: number;
  };
}

export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

export function loadSessionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionConfig {
  return {
    gameServerUri: requireEnv("S1914_GAME_SERVER_URI", env.S1914_GAME_SERVER_URI),
    client: requireEnv("S1914_CLIENT", env.S1914_CLIENT),
    version: requireEnv("S1914_CLIENT_VERSION", env.S1914_CLIENT_VERSION),
    gameID: Number(requireEnv("S1914_GAME_ID", env.S1914_GAME_ID)),
    playerID: Number(requireEnv("S1914_PLAYER_ID", env.S1914_PLAYER_ID)),
    siteUserID: Number(requireEnv("S1914_SITE_USER_ID", env.S1914_SITE_USER_ID)),
    userAuth: requireEnv("S1914_USER_AUTH", env.S1914_USER_AUTH),
    tstamp: requireEnv("S1914_TSTAMP", env.S1914_TSTAMP),
    rights: env.S1914_RIGHTS?.trim() || "chat",
    adminLevel: Number(env.S1914_ADMIN_LEVEL ?? "0"),
    cookieHeader: env.S1914_COOKIE?.trim() || undefined,
  };
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    session: loadSessionFromEnv(env),
    defaults: {
      requestTimeoutMs: Number(env.S1914_TIMEOUT_MS ?? "30000"),
      maxRetries: Number(env.S1914_MAX_RETRIES ?? "2"),
    },
  };
}
