import type { GameId, PlayerId } from "./common.js";

/** One entry from website API `getGames` / `getMyGames`. */
export interface JoinedGameView {
  readonly index: number;
  readonly gameId: GameId;
  readonly title: string;
  readonly comment: string | null;
  readonly state: string;
  readonly dayOfGame: number | null;
  readonly playerCount: number | null;
  readonly openSlots: number | null;
  readonly mapReference: string | null;
  readonly scenarioId: number | null;
  readonly timeScale: number | null;
  /** Your player id inside this game (differs per map). */
  readonly playerId: PlayerId | null;
  readonly joinTime: number | null;
  readonly ranked: boolean;
  readonly isCurrent: boolean;
}

export interface MyGamesSnapshot {
  readonly siteUserId: number;
  readonly currentGameId: GameId | null;
  readonly games: readonly JoinedGameView[];
  readonly resultCode: number;
  readonly resultMessage: string | null;
}
