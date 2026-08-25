import type { AuthProvider, SessionConfig } from "../types/auth.js";
import { loadSessionFromEnv } from "../config/env.js";

/** Loads auth from process env / `.env`. */
export class EnvAuthProvider implements AuthProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getSession(): SessionConfig {
    return loadSessionFromEnv(this.env);
  }
}

/**
 * Reads live credentials from the Ultimate client iframe:
 * `hup.config.userData` + `hup.userActionController.server.serverUri`.
 *
 * Intended for DevTools / browser-injected runners — not Node by default.
 */
export class BrowserSessionProvider implements AuthProvider {
  constructor(
    private readonly getHup: () => S1914HupLike = defaultGetHup,
  ) {}

  getSession(): SessionConfig {
    const hup = this.getHup();
    const userData = hup.config.userData;
    const serverUri = hup.userActionController.server.serverUri;
    if (!serverUri) {
      throw new Error("Game server URI missing on hup.userActionController.server");
    }
    const version =
      hup.config.version ??
      (typeof hup.clientVersion !== "undefined" ? hup.clientVersion : "293");

    return {
      gameServerUri: serverUri,
      client: hup.config.client,
      version: String(version),
      siteUserID: userData.siteUserID,
      playerID: userData.playerID,
      gameID: userData.gameID,
      userAuth: userData.userAuth,
      tstamp: String(userData.tstamp),
      rights: userData.rights ?? "chat",
      adminLevel: userData.adminLevel ?? 0,
    };
  }
}

export interface S1914HupLike {
  config: {
    client: string;
    version?: string | number;
    userData: {
      siteUserID: number;
      playerID: number;
      gameID: number;
      userAuth: string;
      tstamp: string | number;
      rights?: string;
      adminLevel?: number;
    };
  };
  clientVersion?: string | number;
  userActionController: {
    server: {
      serverUri: string;
    };
  };
}

function defaultGetHup(): S1914HupLike {
  const iframe = document.getElementById("ifm") as HTMLIFrameElement | null;
  const win = iframe?.contentWindow as (Window & {
    hup?: S1914HupLike;
    clientVersion?: string | number;
  }) | null;
  if (!win?.hup) {
    throw new Error("Unable to locate iframe#ifm contentWindow.hup");
  }
  if (win.hup.clientVersion === undefined && win.clientVersion !== undefined) {
    win.hup.clientVersion = win.clientVersion;
  }
  return win.hup;
}
