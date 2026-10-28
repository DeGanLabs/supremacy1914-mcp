import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameSession } from "../src/session.js";
import { dispatchTool } from "../src/rpc.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(root, ".env"), override: true });
const gameId = Number(process.env.S1914_SMOKE_GAME_ID || process.env.S1914_GAME_ID);
if (!Number.isFinite(gameId) || gameId <= 0) {
  throw new Error("Set S1914_SMOKE_GAME_ID (or S1914_GAME_ID) to your joined map id");
}

async function main() {
  const session = new GameSession();
  try {
    await dispatchTool(session, "ensure_ready", { gameId });
    const heroes = await dispatchTool(session, "get_heroes", {});
    console.log(JSON.stringify(heroes, null, 2));
  } finally {
    await session.stop().catch(() => undefined);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
