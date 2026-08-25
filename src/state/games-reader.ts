import type { JoinedGameView, MyGamesSnapshot } from "../types/games.js";
import type { GameId } from "../types/common.js";

export interface RawGameProperties {
  gameID?: string | number;
  title?: string;
  comment?: string;
  state?: string;
  dayofgame?: string | number;
  nrofplayers?: string | number;
  openSlots?: string | number;
  mapReference?: string;
  scenarioID?: string | number;
  timeScale?: string | number;
  playerID?: string | number;
  joinTime?: string | number;
  ranked?: string | number;
  [key: string]: unknown;
}

export interface RawGameListEntry {
  properties?: RawGameProperties;
  logins?: unknown[];
}

export interface RawGamesApiResponse {
  result?: RawGameListEntry[] | Record<string, unknown>;
  resultCode?: number;
  resultMessage?: string;
  version?: string;
}

export interface RawHupWebApi {
  getMyGames(
    userId: number,
    callback: (response: RawGamesApiResponse) => void,
  ): void;
  getArchivedGames?(
    userId: number,
    callback: (response: RawGamesApiResponse) => void,
  ): void;
  getGames?(
    params: Record<string, unknown>,
    callback: (response: RawGamesApiResponse) => void,
  ): void;
}

export interface RawHupForGames {
  config: {
    userId?: number;
    userData: {
      siteUserID: number;
      gameID: number;
      playerID: number;
    };
  };
  hupwebapi: RawHupWebApi;
  gameController?: {
    startLoadingTheGame(gameId: number, justJoined?: boolean): void;
    onLoadGame?(event: { data: { gameID: number; justJoined?: boolean } }): void;
  };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapJoinedGame(
  entry: RawGameListEntry,
  index: number,
  currentGameId: GameId | null,
): JoinedGameView | null {
  const p = entry.properties;
  if (!p) return null;
  const gameId = num(p.gameID);
  if (gameId == null) return null;
  return {
    index,
    gameId,
    title: String(p.title ?? `Game ${gameId}`),
    comment: p.comment != null ? String(p.comment) : null,
    state: String(p.state ?? ""),
    dayOfGame: num(p.dayofgame),
    playerCount: num(p.nrofplayers),
    openSlots: num(p.openSlots),
    mapReference: p.mapReference != null ? String(p.mapReference) : null,
    scenarioId: num(p.scenarioID),
    timeScale: num(p.timeScale),
    playerId: num(p.playerID),
    joinTime: num(p.joinTime),
    ranked: String(p.ranked) === "1" || p.ranked === 1,
    isCurrent: currentGameId != null && gameId === currentGameId,
  };
}

export function mapMyGamesResponse(
  response: RawGamesApiResponse,
  options: { siteUserId: number; currentGameId: GameId | null },
): MyGamesSnapshot {
  const rawList = Array.isArray(response.result) ? response.result : [];
  const games = rawList
    .map((entry, index) =>
      mapJoinedGame(entry, index, options.currentGameId),
    )
    .filter((g): g is JoinedGameView => g != null);

  return {
    siteUserId: options.siteUserId,
    currentGameId: options.currentGameId,
    games,
    resultCode: response.resultCode ?? -1,
    resultMessage: response.resultMessage ?? null,
  };
}

/**
 * Lists maps you have joined (website API `getMyGames` → `getGames`).
 * Callback-style under the hood; returns a Promise for Node/browser runners.
 */
export function fetchMyGamesFromHup(
  hup: RawHupForGames,
  options?: { readonly timeoutMs?: number },
): Promise<MyGamesSnapshot> {
  const siteUserId = hup.config.userId ?? hup.config.userData.siteUserID;
  const currentGameId = hup.config.userData.gameID ?? null;
  const timeoutMs = options?.timeoutMs ?? 15000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`getMyGames timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      hup.hupwebapi.getMyGames(siteUserId, (response) => {
        clearTimeout(timer);
        try {
          resolve(
            mapMyGamesResponse(response, { siteUserId, currentGameId }),
          );
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/** Switch the Ultimate client to another joined game (in-tab reload). */
export function loadGameInHup(hup: RawHupForGames, gameId: GameId): void {
  if (!hup.gameController?.startLoadingTheGame) {
    throw new Error("gameController.startLoadingTheGame missing");
  }
  hup.gameController.startLoadingTheGame(Number(gameId), false);
}
