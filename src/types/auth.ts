import type { GameId, PlayerId, UserId } from "./common.js";

/**
 * Auth fields injected into every game-server action JSON body
 * (see client `signMessage`).
 */
export interface GameAuthCredentials {
  readonly siteUserID: UserId;
  readonly playerID: PlayerId;
  readonly gameID: GameId;
  readonly userAuth: string;
  readonly tstamp: string;
  readonly rights: string;
  readonly adminLevel: number;
}

export interface ClientIdentity {
  /** e.g. s1914-client-ultimate */
  readonly client: string;
  /** e.g. "293" */
  readonly version: string;
}

export interface SessionConfig extends GameAuthCredentials, ClientIdentity {
  /** Game server pool URI used by `server.sendMessage`. */
  readonly gameServerUri: string;
  /** Optional Cookie header for HTTP transport. */
  readonly cookieHeader?: string;
}

export type AuthProvider = {
  getSession(): Promise<SessionConfig> | SessionConfig;
};
