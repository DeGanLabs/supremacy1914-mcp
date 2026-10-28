/**
 * Deploy one inventory hero to an own province.
 *   npx tsx scripts/smoke-deploy-hero.ts
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
    await dispatchTool(session, "ensure_ready", { gameId });

    const heroes = (await dispatchTool(session, "get_heroes", {})) as {
      deployable?: Array<{
        itemId?: number;
        id?: number;
        name?: string;
        shortName?: string;
      }>;
      inventory?: Array<{
        itemId?: number;
        id?: number;
        name?: string;
        shortName?: string;
        deployable?: boolean;
      }>;
      deployedCount?: number;
      maxDeployed?: number;
      limitReached?: boolean;
    };

    process.stderr.write(
      `[deploy] deployed ${heroes.deployedCount ?? "?"}/${heroes.maxDeployed ?? "?"} limitReached=${heroes.limitReached}\n`,
    );

    const pool =
      heroes.deployable?.length
        ? heroes.deployable
        : (heroes.inventory || []).filter((h) => h.deployable !== false);

    if (!pool.length) {
      console.log(
        JSON.stringify(
          { ok: false, error: "no deployable heroes in inventory", heroes },
          null,
          2,
        ),
      );
      process.exitCode = 2;
      return;
    }

    // Prefer Callahan if present (day-1 unlock); else first truly deployable
    const hero =
      pool.find((h) =>
        /callahan|hank/i.test(String(h.shortName || h.name || "")),
      ) || pool[0]!;
    const heroIdOrName =
      hero.shortName || hero.name || hero.itemId || hero.id;
    if (heroIdOrName == null) throw new Error("hero has no id/name");
    process.stderr.write(
      `[deploy] deployable=${pool.map((h) => h.shortName || h.name).join(", ")}\n`,
    );

    const finance = (await dispatchTool(session, "get_finance_picture", {})) as {
      provinces?: Array<{ name?: string; id?: number }>;
    };
    const province =
      finance.provinces?.find((p) => p.name)?.name ||
      finance.provinces?.[0]?.id;
    if (province == null) throw new Error("no own province to deploy into");

    process.stderr.write(
      `[deploy] deploying ${JSON.stringify(heroIdOrName)} → ${province}\n`,
    );

    const result = await dispatchTool(session, "deploy_hero", {
      heroIdOrName,
      provinceIdOrName: province,
      confirm: true,
    });

    console.log(
      JSON.stringify(
        { ok: true, heroIdOrName, province, result },
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
