/**
 * Direct MCP-path smoke: same dispatch as tools/call.
 *   npx tsx scripts/smoke-finance.ts
 */
import { config as loadDotenv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameSession } from "../src/session.js";
import { dispatchTool } from "../src/rpc.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(root, ".env"), override: true });

async function main(): Promise<void> {
  const session = new GameSession();
  process.stderr.write("[smoke] starting Playwright session…\n");
  try {
    const gameId = Number(process.env.S1914_SMOKE_GAME_ID || process.env.S1914_GAME_ID);
    if (!Number.isFinite(gameId) || gameId <= 0) {
      throw new Error("Set S1914_SMOKE_GAME_ID (or S1914_GAME_ID) to your joined map id");
    }
    process.stderr.write(`[smoke] ensure_ready gameId=${gameId}…\n`);
    const ready = (await dispatchTool(session, "ensure_ready", { gameId })) as {
      ok?: boolean;
      hupReady?: boolean;
      gameId?: number | null;
      steps?: string[];
      error?: string;
    };
    process.stderr.write(`[smoke] ensure_ready: ${JSON.stringify(ready)}\n`);

    const health = (await dispatchTool(session, "health", {})) as {
      ok?: boolean;
      hupReady?: boolean;
      gameId?: number | null;
      error?: string;
    };
    process.stderr.write(`[smoke] health: ${JSON.stringify(health)}\n`);

    if (!health?.hupReady) {
      process.stderr.write(
        "[smoke] FAIL — set S1914_EMAIL/S1914_PASSWORD or log in once in the Playwright window, then re-run.\n",
      );
      process.exitCode = 2;
      return;
    }

    // Map can lag a beat after hup; one retry for finance
    let finance: unknown;
    try {
      finance = await dispatchTool(session, "get_finance_picture", {});
    } catch (err) {
      process.stderr.write(
        `[smoke] finance retry after wait: ${err instanceof Error ? err.message : err}\n`,
      );
      await new Promise((r) => setTimeout(r, 5000));
      finance = await dispatchTool(session, "get_finance_picture", {});
    }
    const resources = await dispatchTool(session, "get_resources", {});
    const market = await dispatchTool(session, "get_market", {});

    const outPath = path.join(root, "data", "smoke-finance.json");
    mkdirSync(path.join(root, "data"), { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify({ health, get_finance_picture: finance, get_resources: resources, get_market: market }, null, 2),
    );

    const fin = finance as { provinces?: unknown[] };
    const res = resources as { resources?: unknown[] };
    console.log(
      JSON.stringify({
        ok: true,
        saved: outPath,
        gameId: health.gameId,
        provinceCount: fin.provinces?.length ?? null,
        resourceKeys: res.resources?.length ?? null,
        marketRows: Array.isArray(market) ? market.length : null,
      }),
    );
  } finally {
    await session.stop().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
