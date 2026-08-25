/**
 * Node smoke test for builders + env loading (no live server call unless .env is set).
 *
 *   npm install
 *   cp .env.example .env   # fill auth from browser session
 *   npm run smoke
 */
import { config as loadDotenv } from "dotenv";
import {
  buildSignedArmyMoveAction,
  buildWireUnits,
  loadSessionFromEnv,
} from "../index.js";

loadDotenv();

function main(): void {
  console.log("s1914-automation smoke");

  // Dry-run builder without requiring full env when missing
  const hasAuth = Boolean(process.env.S1914_USER_AUTH && process.env.S1914_GAME_ID);
  if (!hasAuth) {
    console.log("No .env auth yet — validating builder with mock session only.");
    const mockSession = {
      gameServerUri: "https://example.invalid",
      client: "s1914-client-ultimate",
      version: "293",
      siteUserID: 1,
      playerID: 1,
      gameID: 1,
      userAuth: "deadbeef",
      tstamp: "0",
      rights: "chat",
      adminLevel: 0,
    };

    const action = buildSignedArmyMoveAction({
      session: mockSession,
      armyId: 123,
      ownerId: 1,
      units: buildWireUnits([{ typeId: 2, size: 1 }]),
      path: [
        {
          start: { x: 0, y: 0 },
          target: { x: 10, y: 10 },
        },
      ],
    });

    console.log("Built action class:", action["@c"]);
    console.log("Nested army action:", (action.actions[0] as { "@c": string })["@c"]);
    console.log("OK — skeleton builders work.");
    return;
  }

  const session = loadSessionFromEnv();
  console.log("Loaded session for game", session.gameID, "player", session.playerID);
  console.log("Server URI:", session.gameServerUri);
  console.log("OK — env auth loaded (not sending live request in smoke).");
}

main();
