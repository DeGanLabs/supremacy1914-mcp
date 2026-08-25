import { config as loadDotenv } from "dotenv";
import { loadAppConfig } from "./config/env.js";
import { GameSession } from "./session/session.js";
import { EnvAuthProvider, BrowserSessionProvider } from "./session/auth-provider.js";
import { HttpGameTransport } from "./transport/http-client.js";
import {
  BrowserBridgeExecutor,
  type BrowserHupArmyApi,
  type HupAccessor,
} from "./transport/browser-bridge.js";
import {
  HttpArmyActionExecutor,
  type ArmyWireContextProvider,
  type PathProvider,
} from "./actions/http-army-executor.js";
import { GameService } from "./services/game-service.js";
import type { GameSnapshot } from "./types/game.js";
import type { ArmyActionExecutor } from "./transport/executor.js";
import type { AuthProvider } from "./types/auth.js";

export type RuntimeMode = "http" | "browser";

export interface CreateHttpClientOptions {
  readonly mode: "http";
  readonly loadEnvFile?: boolean;
  readonly authProvider?: AuthProvider;
  readonly readSnapshot: () => Promise<GameSnapshot> | GameSnapshot;
  readonly readCommunications?: () =>
    | Promise<import("./types/messages.js").CommunicationsSnapshot>
    | import("./types/messages.js").CommunicationsSnapshot;
  readonly readStats?: () =>
    | Promise<import("./types/stats.js").FullStatsSnapshot>
    | import("./types/stats.js").FullStatsSnapshot;
  readonly readDiplomacyMatrix?: () =>
    | Promise<import("./types/relations.js").DiplomacyMatrixSnapshot>
    | import("./types/relations.js").DiplomacyMatrixSnapshot;
  readonly readKnownCountries?: (
    onlyPlayerIds?: readonly number[],
  ) =>
    | Promise<import("./state/relations-reader.js").KnownCountryStats[]>
    | import("./state/relations-reader.js").KnownCountryStats[];
  readonly readSpies?: () =>
    | Promise<import("./types/spy.js").SpySnapshotDetailed | null>
    | import("./types/spy.js").SpySnapshotDetailed
    | null;
  readonly pathProvider: PathProvider;
  readonly armyWireContext: ArmyWireContextProvider;
  readonly timeoutMs?: number;
}

export interface CreateBrowserClientOptions {
  readonly mode: "browser";
  readonly authProvider?: AuthProvider;
  readonly readSnapshot: () => Promise<GameSnapshot> | GameSnapshot;
  readonly readCommunications?: () =>
    | Promise<import("./types/messages.js").CommunicationsSnapshot>
    | import("./types/messages.js").CommunicationsSnapshot;
  readonly readStats?: () =>
    | Promise<import("./types/stats.js").FullStatsSnapshot>
    | import("./types/stats.js").FullStatsSnapshot;
  readonly readDiplomacyMatrix?: () =>
    | Promise<import("./types/relations.js").DiplomacyMatrixSnapshot>
    | import("./types/relations.js").DiplomacyMatrixSnapshot;
  readonly readKnownCountries?: (
    onlyPlayerIds?: readonly number[],
  ) =>
    | Promise<import("./state/relations-reader.js").KnownCountryStats[]>
    | import("./state/relations-reader.js").KnownCountryStats[];
  readonly readSpies?: () =>
    | Promise<import("./types/spy.js").SpySnapshotDetailed | null>
    | import("./types/spy.js").SpySnapshotDetailed
    | null;
  readonly hupAccessor?: HupAccessor;
}

export type CreateClientOptions = CreateHttpClientOptions | CreateBrowserClientOptions;

export interface S1914Client {
  readonly session: GameSession;
  readonly game: GameService;
  readonly armyExecutor: ArmyActionExecutor;
}

export function createS1914Client(options: CreateClientOptions): S1914Client {
  if (options.mode === "http" && options.loadEnvFile !== false) {
    loadDotenv();
  }

  const authProvider =
    options.authProvider ??
    (options.mode === "browser"
      ? new BrowserSessionProvider()
      : new EnvAuthProvider());

  const session = new GameSession(authProvider);
  const armyExecutor = createExecutor(options, session);

  const game = new GameService({
    readSnapshot: options.readSnapshot,
    readCommunications: options.readCommunications,
    readStats: options.readStats,
    readDiplomacyMatrix: options.readDiplomacyMatrix,
    readKnownCountries: options.readKnownCountries,
    readSpies: options.readSpies,
    armyExecutor,
  });

  return { session, game, armyExecutor };
}

function createExecutor(
  options: CreateClientOptions,
  session: GameSession,
): ArmyActionExecutor {
  if (options.mode === "browser") {
    return new BrowserBridgeExecutor(options.hupAccessor ?? defaultBrowserHupAccessor);
  }

  const appConfig = loadAppConfig();
  const transport = new HttpGameTransport(() => session.getConfig(), {
    timeoutMs: options.timeoutMs ?? appConfig.defaults.requestTimeoutMs,
  });

  return new HttpArmyActionExecutor(
    () => session.getConfig(),
    transport,
    options.pathProvider,
    options.armyWireContext,
  );
}

export function defaultBrowserHupAccessor(): BrowserHupArmyApi {
  const iframe = document.getElementById("ifm") as HTMLIFrameElement | null;
  const win = iframe?.contentWindow as (Window & { hup?: BrowserHupArmyApi }) | null;
  if (!win?.hup) {
    throw new Error("Unable to locate iframe#ifm contentWindow.hup");
  }
  return win.hup;
}
