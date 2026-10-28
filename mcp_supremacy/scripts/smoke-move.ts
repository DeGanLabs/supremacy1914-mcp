/**
 * Live move smoke (requires S1914_MCP_WRITES=1).
 *   npx tsx scripts/smoke-move.ts
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameSession } from "../src/session.js";
import { dispatchTool } from "../src/rpc.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(root, ".env"), override: true });

process.env.S1914_MCP_WRITES = "1";

const gameId = Number(process.env.S1914_SMOKE_GAME_ID || process.env.S1914_GAME_ID);
if (!Number.isFinite(gameId) || gameId <= 0) {
  throw new Error("Set S1914_SMOKE_GAME_ID (or S1914_GAME_ID) to your joined map id");
}

async function main(): Promise<void> {
  const session = new GameSession();
  try {
    process.stderr.write(`[smoke-move] ensure_ready ${gameId}\n`);
    const ready = await dispatchTool(session, "ensure_ready", { gameId });
    process.stderr.write(`${JSON.stringify(ready)}\n`);

    const armies = (await dispatchTool(session, "get_own_armies", {})) as Array<{
      id: number;
      province?: string;
      pos?: { x: number; y: number };
      onSea?: boolean;
    }>;

    if (!Array.isArray(armies) || armies.length === 0) {
      throw new Error("no own armies");
    }

    // Prefer land stack with a position
    const army =
      armies.find((a) => a.pos && !a.onSea) ||
      armies.find((a) => a.pos) ||
      armies[0]!;

    if (!army.pos) throw new Error(`army ${army.id} has no pos`);

    // Short nudge (~40 map units) so path stays valid / low risk
    const x = Math.round(army.pos.x + 40);
    const y = Math.round(army.pos.y);

    process.stderr.write(
      `[smoke-move] moving army ${army.id} from ${army.province ?? "?"} (${army.pos.x},${army.pos.y}) → (${x},${y})\n`,
    );

    const result = await dispatchTool(session, "move_army", {
      armyId: army.id,
      x,
      y,
      confirm: true,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          armyId: army.id,
          from: army.pos,
          to: { x, y },
          province: army.province,
          result,
        },
        null,
        2,
      ),
    );
  } finally {
    await session.stop().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
