import type { GameSession } from "./session.js";
import { assertWriteAllowed, findTool, TOOLS, type ToolDef } from "./tools.js";
import { campaignDiff, listHistory, takeSnapshot } from "./history.js";
import {
  capabilitiesReport,
  executeActions,
  noteProbe,
  previewActions,
  verifyActions,
} from "./pipeline.js";

/** Strip confirm before sending args into the page. */
function pageArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { confirm: _c, fresh: _f, ...rest } = args;
  return rest;
}

export function listToolDefs(): ToolDef[] {
  return TOOLS;
}

const CACHEABLE = new Set([
  "get_resources",
  "get_own_armies",
  "get_war_picture",
  "get_finance_picture",
  "list_games",
  "get_provinces",
  "get_economy",
  "get_players",
  "get_military",
  "get_operations",
]);

const cache = new Map<string, { at: number; value: unknown }>();

function cacheTtlMs(): number {
  const n = Number(process.env.S1914_READ_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 10_000;
}

function cacheKey(name: string, args: Record<string, unknown>): string {
  return name + ":" + JSON.stringify(pageArgs(args));
}

function deadlineMs(name: string, write: boolean): number {
  if (name === "ensure_ready" || name === "open_game" || name === "login") {
    // Cold Chromium + Ultimate map often needs >35s; ChatGPT still may client-timeout ~60s.
    return 55_000;
  }
  if (name === "map_screenshot") return 2_000;
  if (
    name === "preview_actions" ||
    name === "execute_actions" ||
    name === "verify_actions" ||
    name === "get_provinces" ||
    name === "get_economy" ||
    name === "get_military" ||
    name === "campaign_snapshot"
  ) {
    return 40_000;
  }
  if (write) return 25_000;
  return 15_000;
}

export async function dispatchTool(
  session: GameSession,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  assertWriteAllowed(tool, args);

  // health must not queue behind a long open_game
  if (name === "health") {
    return session.health();
  }
  if (name === "get_connector_capabilities") {
    return capabilitiesReport(session);
  }

  const ttl = cacheTtlMs();
  const key = cacheKey(name, args);
  if (CACHEABLE.has(name) && args.fresh !== true && ttl > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) {
      const age = Date.now() - hit.at;
      if (hit.value && typeof hit.value === "object" && !Array.isArray(hit.value)) {
        return { ...(hit.value as object), cached: true, cacheAgeMs: age };
      }
      return { cached: true, cacheAgeMs: age, data: hit.value };
    }
  }

  return session.enqueue(name, deadlineMs(name, !!tool.write), async () => {
    if (name === "campaign_snapshot" || name === "campaign_diff" || name === "campaign_history") {
      return runHistory(session, name, args);
    }

    if (name === "ensure_ready") {
      const gameId =
        args.gameId != null && Number.isFinite(Number(args.gameId))
          ? Number(args.gameId)
          : undefined;
      const login = args.login === false ? false : undefined;
      return session.ensureReady({ gameId, login });
    }
    if (name === "login") {
      return session.login();
    }
    if (name === "open_game") {
      const gameId = Number(args.gameId);
      if (!Number.isFinite(gameId)) throw new Error("open_game needs gameId");
      return session.openGame(gameId);
    }
    if (name === "map_screenshot") {
      return session.mapScreenshot(pageArgs(args));
    }
    if (name === "preview_actions") {
      return previewActions(session, pageArgs(args));
    }
    if (name === "execute_actions") {
      return executeActions(session, pageArgs(args));
    }
    if (name === "verify_actions") {
      return verifyActions(session, pageArgs(args));
    }

    if (name === "use_game" && args.gameId != null) {
      const gameId = Number(args.gameId);
      if (Number.isFinite(gameId) && gameId > 1000) {
        const opened = await session.openGame(gameId);
        if (opened.ok) return opened;
      }
    }

    const result = await session.call(tool.name, pageArgs(args));

    if (name === "use_game") {
      await session.afterNavigation();
      if (result && typeof result === "object" && (result as { ok?: boolean }).ok === true) {
        return {
          ...(result as Record<string, unknown>),
          sessionVersion: session.bumpSession(),
        };
      }
    }

    if (result && typeof result === "object" && "probe" in (result as object)) {
      noteProbe((result as { probe?: Record<string, unknown> }).probe);
    }
    if (CACHEABLE.has(name) && result && typeof result === "object" && args.fresh !== true) {
      cache.set(key, { at: Date.now(), value: result });
    }
    return result;
  });
}

async function runHistory(
  session: GameSession,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const health = await session.health();
  const gameId = health.gameId;
  if (!gameId) {
    throw new Error(
      "need_ensure_ready: no open game. Call ensure_ready({ gameId }) first.",
    );
  }
  if (name === "campaign_history") {
    const limit = args.limit != null ? Number(args.limit) : 30;
    return listHistory(gameId, Number.isFinite(limit) ? limit : 30);
  }
  if (name === "campaign_diff") {
    return campaignDiff(gameId, args.since != null ? String(args.since) : undefined);
  }
  const provinces: unknown[] = [];
  let cursor: string | undefined;
  let probe: Record<string, unknown> | undefined;
  for (let pageNo = 0; pageNo < 20; pageNo++) {
    const page = (await session.call("get_provinces", {
      include: ["resource", "buildings", "morale"],
      limit: 200,
      cursor,
    })) as { provinces?: unknown[]; nextCursor?: string | null; probe?: Record<string, unknown> };
    if (Array.isArray(page.provinces)) provinces.push(...page.provinces);
    probe = page.probe ?? probe;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const economy = await session.call("get_economy", { include: ["stocks"] });
  const armies = await session.call("get_own_armies", {});
  let wars: unknown[] = [];
  try {
    const picture = (await session.call("get_war_picture", {})) as {
      wars?: unknown[];
      enemies?: unknown[];
    };
    wars = Array.isArray(picture?.wars)
      ? picture.wars
      : Array.isArray(picture?.enemies)
        ? picture.enemies
        : [];
  } catch {
    wars = [];
  }
  const econ = economy as { stocks?: { resources?: unknown }; probe?: Record<string, unknown> };
  noteProbe(probe);
  noteProbe(econ.probe);
  return takeSnapshot(gameId, {
    provinces,
    resources: econ.stocks?.resources ?? [],
    armies,
    wars,
  });
}
