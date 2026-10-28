/**
 * Move one own army to another own province capital.
 *   npx tsx scripts/smoke-move-capital.ts
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
const preferName = process.env.S1914_SMOKE_CAPITAL?.trim() || "";

async function main(): Promise<void> {
  const session = new GameSession();
  try {
    await dispatchTool(session, "ensure_ready", { gameId });

    const finance = (await dispatchTool(session, "get_finance_picture", {})) as {
      provinces?: Array<{
        id?: number;
        name?: string;
        capital?: { x: number; y: number } | null;
      }>;
    };
    const armies = (await dispatchTool(session, "get_own_armies", {})) as Array<{
      id: number;
      province?: string;
      pos?: { x: number; y: number };
      onSea?: boolean;
    }>;

    const caps = (finance.provinces || []).filter(
      (p) => p.capital && Number.isFinite(p.capital.x) && p.name,
    );
    if (!caps.length) throw new Error("no province capitals in finance picture");
    if (!armies?.length) throw new Error("no armies");

    const army =
      armies.find((a) => a.pos && !a.onSea) ||
      armies.find((a) => a.pos) ||
      armies[0]!;
    if (!army.pos) throw new Error("army has no pos");

    // Pick a capital that is not the army's current province (if possible)
    let dest =
      (preferName &&
        caps.find(
          (p) => p.name!.toLowerCase() === preferName.toLowerCase(),
        )) ||
      caps.find(
        (p) =>
          p.name &&
          army.province &&
          p.name.toLowerCase() !== army.province.toLowerCase(),
      ) ||
      caps[0]!;

    const x = Math.round(dest.capital!.x);
    const y = Math.round(dest.capital!.y);

    process.stderr.write(
      `[move-capital] army ${army.id} (${army.province}) → capital ${dest.name} (${x},${y})\n`,
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
          fromProvince: army.province,
          toCapital: dest.name,
          to: { x, y },
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
