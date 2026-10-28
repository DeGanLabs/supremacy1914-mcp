import type { BrowserBridgeServer } from "../sensor/bridge-client.js";
import type { ScopeToolGateway } from "../sensor/gateway.js";
import { DEFAULT_SEAT_SCOPES } from "../cabinet/cost-caps.js";
import { buildFinancePicture } from "./build-picture.js";
import type { FinanceMemory } from "./memory.js";
import type { FinanceMode, FinancePicture, RawFinanceInput } from "./types.js";

const SEAT = "finance-watch";

function normalizeResourcesDump(raw: unknown): {
  money: number;
  resources: {
    id: number;
    name: string;
    amount: number;
    production: number;
    consumption: number;
    rate: number;
    isCritical?: boolean;
  }[];
} {
  if (Array.isArray(raw)) {
    return {
      money:
        raw.find((r) => /money|gold|geld/i.test(String((r as { name?: string }).name)))
          ?.amount ?? 0,
      resources: raw as {
        id: number;
        name: string;
        amount: number;
        production: number;
        consumption: number;
        rate: number;
        isCritical?: boolean;
      }[],
    };
  }
  const o = raw as {
    money?: number;
    resources?: {
      id: number;
      name: string;
      amount: number;
      production: number;
      consumption: number;
      rate: number;
      isCritical?: boolean;
    }[];
  };
  return {
    money: o.money ?? 0,
    resources: o.resources ?? [],
  };
}

export async function collectRawFinanceInput(
  bridge: BrowserBridgeServer,
  gateway: ScopeToolGateway,
  opts: {
    mode?: FinanceMode;
    warDemand?: FinancePicture["national"]["warDemand"];
    events?: { t: string; line: string }[];
  } = {},
): Promise<RawFinanceInput> {
  const scopes = DEFAULT_SEAT_SCOPES[SEAT];
  gateway.resetTurn(SEAT);

  const resourcesDumpRaw = await gateway.call(SEAT, scopes, "get_resources", {});
  const resourcesDump = normalizeResourcesDump(resourcesDumpRaw);

  let provinces: RawFinanceInput["provinces"] = [];
  let mapSize: RawFinanceInput["mapSize"] = null;
  let selfPlayerId: number | null = null;

  try {
    const fp = (await bridge.call("dump_finance_provinces", {})) as {
      selfPlayerId?: number;
      mapSize?: { width: number; height: number };
      provinces?: RawFinanceInput["provinces"];
    };
    provinces = fp.provinces ?? [];
    mapSize = fp.mapSize ?? null;
    selfPlayerId = fp.selfPlayerId ?? null;
  } catch {
    try {
      const world = (await gateway.call(SEAT, scopes, "get_world_summary", {})) as {
        selfPlayerId?: number;
        mapSize?: { width: number; height: number };
        provinces?: {
          id: number;
          name: string;
          ownerId: number;
          morale: number | null;
          coastal: boolean;
          capital: { x: number; y: number } | null;
        }[];
      };
      selfPlayerId = world.selfPlayerId ?? null;
      mapSize = world.mapSize ?? null;
      provinces = (world.provinces ?? [])
        .filter((p) => selfPlayerId == null || p.ownerId === selfPlayerId)
        .map((p) => ({
          id: p.id,
          name: p.name,
          capital: p.capital,
          coastal: !!p.coastal,
          morale: p.morale,
        }));
    } catch {
      provinces = [];
    }
  }

  const enriched = [];
  for (const p of provinces.slice(0, 36)) {
    let upgrades: { upgradeId: number; name: string; group?: string | null }[] = [];
    let buildings: { id: number | null; name: string | null }[] = [];
    let constructions: unknown[] = [];
    try {
      const slots = (await bridge.call("dump_province_slots", {
        provinceIdOrName: p.name,
      })) as {
        improvements?: { id: number; name: string | null }[];
        constructions?: unknown[];
      };
      buildings = (slots.improvements ?? []).map((i) => ({
        id: i.id ?? null,
        name: i.name,
      }));
      constructions = slots.constructions ?? [];
    } catch {
      /* ignore */
    }
    try {
      const ups = (await bridge.call("list_province_upgrades", {
        provinceIdOrName: p.name,
      })) as {
        upgrades?: { upgradeId: number; name: string; group?: string | null }[];
      };
      upgrades = ups.upgrades ?? [];
    } catch {
      /* ignore */
    }
    enriched.push({
      ...p,
      buildings: buildings.length ? buildings : p.buildings,
      constructions,
      upgrades,
    });
  }
  for (const p of provinces.slice(36)) enriched.push(p);

  let market: RawFinanceInput["market"] = [];
  try {
    const m = (await gateway.call(SEAT, scopes, "get_market", {})) as {
      resources?: {
        resourceId: number;
        name: string;
        price: number | null;
        asks?: { limit: number }[];
        bids?: { limit: number }[];
      }[];
    };
    market = m.resources ?? [];
  } catch {
    market = [];
  }

  let embargoes: RawFinanceInput["embargoes"] = [];
  try {
    const rel = (await gateway.call(SEAT, scopes, "get_relations", {})) as {
      countries?: {
        playerId: number;
        name?: string;
        nationName?: string;
        relationLabel?: string;
      }[];
      nonPeace?: { playerId: number; name?: string; nation?: string; relation?: string }[];
    };
    const rows = rel.countries ?? [];
    embargoes = rows
      .filter((c) => /embargo/i.test(c.relationLabel ?? ""))
      .map((c) => ({
        t: new Date().toISOString(),
        playerId: c.playerId,
        name: c.name ?? null,
        nation: c.nationName ?? null,
        line: `Trade embargo — ${c.nationName ?? c.name ?? c.playerId}`,
      }));
  } catch {
    embargoes = [];
  }

  const money =
    resourcesDump.money ??
    resourcesDump.resources?.find((r) => /money|gold|geld/i.test(r.name))
      ?.amount ??
    0;

  return {
    selfPlayerId,
    mapSize,
    money,
    resources: (resourcesDump.resources ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      production: r.production,
      consumption: r.consumption,
      rate: r.rate,
      isCritical: r.isCritical,
    })),
    provinces: enriched,
    market,
    embargoes,
    warDemand: opts.warDemand ?? [],
    mode: opts.mode ?? "economy",
    events: opts.events ?? [],
  };
}

export function startFinanceWatch(opts: {
  bridge: BrowserBridgeServer;
  gateway: ScopeToolGateway;
  memory: FinanceMemory;
  intervalMs: number;
  enabled: boolean;
  getMode?: () => FinanceMode;
  onUpdate?: (picture: FinancePicture) => void;
}): { stop: () => void; tickNow: () => Promise<FinancePicture | null> } {
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const tickNow = async (): Promise<FinancePicture | null> => {
    if (!opts.bridge.isHealthy()) return null;
    if (busy) return null;
    busy = true;
    try {
      const warDemand = await opts.memory.loadWarDemand();
      const events = await opts.memory.loadRecentEvents(80);
      const raw = await collectRawFinanceInput(opts.bridge, opts.gateway, {
        mode: opts.getMode?.() ?? "economy",
        warDemand,
        events,
      });
      const picture = buildFinancePicture(raw);
      const prev = await opts.memory.loadFinancePicture();
      await opts.memory.saveFinancePicture(picture);
      if (prev?.national.bottleneck?.name !== picture.national.bottleneck?.name) {
        await opts.memory.appendEvent(
          `Bottleneck → ${picture.national.bottleneck?.name ?? "none"}`,
        );
      }
      opts.onUpdate?.(picture);
      return picture;
    } finally {
      busy = false;
    }
  };

  if (opts.enabled && opts.intervalMs > 0) {
    void tickNow();
    timer = setInterval(() => {
      void tickNow();
    }, opts.intervalMs);
  }

  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
    tickNow,
  };
}
