import type { ArmySnapshot } from "./army.js";
import type { DiplomacySnapshot } from "./diplomacy.js";
import type { EconomySnapshot } from "./resources.js";
import type { CommunicationsSnapshot } from "./messages.js";
import type { FullStatsSnapshot } from "./stats.js";
import type { GameId, PlayerId } from "./common.js";

export interface GameIdentity {
  readonly gameId: GameId;
  readonly playerId: PlayerId;
  readonly siteUserId: number;
  readonly nationName?: string;
  readonly playerName?: string;
}

export interface GameSnapshot {
  readonly identity: GameIdentity;
  readonly economy: EconomySnapshot;
  readonly armies: readonly ArmySnapshot[];
  readonly diplomacy: DiplomacySnapshot;
  readonly communications?: CommunicationsSnapshot;
  readonly stats?: FullStatsSnapshot;
  readonly serverTimestamp?: number;
}
