import type { GameSnapshot } from "../types/game.js";
import { readOwnArmiesFromHup } from "./army-reader.js";
import { readEconomyFromHup } from "./resource-reader.js";
import { readDiplomacyFromHup } from "./diplomacy-reader.js";
import { readCommunicationsFromHup } from "./message-reader.js";
import { readFullStatsFromHup } from "./stats-reader.js";

/** Loose structural root for the Ultimate client `hup` object. */
export type HupGameRoot = {
  config: {
    userData: {
      playerID: number;
      gameID: number;
      siteUserID: number;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gameState: any;
};

export interface ReadGameSnapshotOptions {
  readonly includeCommunications?: boolean;
  readonly includeStats?: boolean;
}

export function readGameSnapshotFromHup(
  hup: HupGameRoot,
  options?: ReadGameSnapshotOptions,
): GameSnapshot {
  const includeCommunications = options?.includeCommunications !== false;
  const includeStats = options?.includeStats !== false;

  return {
    identity: {
      gameId: hup.config.userData.gameID,
      playerId: hup.config.userData.playerID,
      siteUserId: hup.config.userData.siteUserID,
    },
    economy: readEconomyFromHup(hup),
    armies: readOwnArmiesFromHup(hup),
    diplomacy: readDiplomacyFromHup(hup),
    communications: includeCommunications
      ? readCommunicationsFromHup(hup)
      : undefined,
    stats: includeStats ? readFullStatsFromHup(hup) : undefined,
    serverTimestamp: hup.gameState.getTimeStamp?.(),
  };
}
