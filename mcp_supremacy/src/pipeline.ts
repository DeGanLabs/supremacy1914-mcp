import { randomBytes } from "node:crypto";
import type { GameSession } from "./session.js";

const TTL_MS = 10 * 60 * 1000;

type Action = Record<string, unknown>;

type PreviewAction = Action & {
  valid: boolean;
  reason?: string;
  before?: unknown;
  steps?: { upgradeId: number; before: boolean | null }[];
};

type Preview = {
  previewId: string;
  gameId: number;
  sessionVersion: number;
  expiresAt: string;
  valid: boolean;
  actions: PreviewAction[];
  preEconomy?: unknown;
  executed?: boolean;
};

const previews = new Map<string, Preview>();
let probeMemory: Record<string, unknown> = {};

export function noteProbe(partial: Record<string, unknown> | null | undefined): void {
  if (!partial || typeof partial !== "object") return;
  probeMemory = { ...probeMemory, ...partial, at: new Date().toISOString() };
}

export function capabilitiesReport(session: GameSession): Record<string, unknown> {
  return {
    sessionVersion: session.sessionVersion(),
    tools: [
      "get_provinces",
      "get_economy",
      "get_players",
      "get_military",
      "preview_actions",
      "execute_actions",
      "verify_actions",
    ],
    probe: probeMemory,
    notes: [
      "Reads do not change the game. Writes run only through execute_actions with a live previewId.",
      "verify_actions is a fresh client read: verified, failed, or unknown.",
      "Null upkeep or null economic estimates are unknown, not zero.",
      "Foreign armies and provinces stay confidence fog.",
    ],
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

async function provinceCard(
  session: GameSession,
  action: Action,
): Promise<Record<string, unknown> | null> {
  const args: Record<string, unknown> = {
    include: ["buildings", "resource", "morale"],
    limit: 5,
    fresh: true,
  };
  if (action.provinceIdOrName != null) args.provinceIdOrName = action.provinceIdOrName;
  else if (action.provinceId != null) args.provinceIdOrName = action.provinceId;
  else if (action.province != null) args.provinceIdOrName = action.province;
  else return null;
  const page = asRecord(await session.call("get_provinces", args));
  const list = Array.isArray(page?.provinces) ? page.provinces : [];
  return asRecord(list[0]);
}

function matchBuilding(
  card: Record<string, unknown>,
  action: Action,
): Record<string, unknown> | null {
  const buildings = Array.isArray(card.buildings) ? card.buildings : [];
  const needle = String(action.building ?? action.upgradeName ?? "")
    .trim()
    .toLowerCase();
  const upgradeId = action.upgradeId != null ? Number(action.upgradeId) : null;
  for (const raw of buildings) {
    const b = asRecord(raw);
    if (!b) continue;
    const ids = Array.isArray(b.upgradeIds) ? b.upgradeIds.map(Number) : [];
    const name = String(b.name ?? "").toLowerCase();
    if (upgradeId != null && ids.includes(upgradeId)) return b;
    if (needle && (name === needle || name.includes(needle))) return b;
  }
  return null;
}

async function describeAction(session: GameSession, action: Action): Promise<PreviewAction> {
  const type = String(action.type || "");
  if (!type) return { ...action, valid: false, reason: "action.type required" };
  if (type === "set_building_enabled") {
    if (typeof action.enabled !== "boolean") {
      return { ...action, type, valid: false, reason: "enabled must be boolean" };
    }
    const card = await provinceCard(session, action);
    if (!card) return { ...action, type, valid: false, reason: "province not found" };
    const building = matchBuilding(card, action);
    if (!building) return { ...action, type, valid: false, reason: "building not found on province" };
    const ids = Array.isArray(building.upgradeIds) ? building.upgradeIds.map(Number) : [];
    const only = action.upgradeId != null ? Number(action.upgradeId) : null;
    const targetIds = only != null ? ids.filter((id) => id === only) : ids;
    const levels = Array.isArray(building.levels) ? building.levels : [];
    const steps = targetIds.map((id) => {
      const level = levels.map(asRecord).find((l) => l && Number(l.upgradeId) === id);
      return {
        upgradeId: id,
        before: level && typeof level.enabled === "boolean" ? level.enabled : null,
      };
    });
    return {
      ...action,
      type,
      valid: targetIds.length > 0,
      reason: targetIds.length ? undefined : "no upgrade ids on that building",
      before: {
        name: building.name,
        enabled: building.enabled,
        enabledVerified: building.enabledVerified,
        enabledScope: building.enabledScope,
        upgradeIds: targetIds,
      },
      steps,
    };
  }
  if (type === "construct_building" || type === "cancel_building" || type === "produce_unit" || type === "cancel_unit_production") {
    const card = await provinceCard(session, action);
    if (!card) return { ...action, type, valid: false, reason: "province not found" };
    if ((type === "construct_building" || type === "produce_unit") && action.upgradeId == null && action.unitTypeId == null) {
      return { ...action, type, valid: false, reason: "upgradeId or unitTypeId required" };
    }
    return {
      ...action,
      type,
      valid: true,
      before: { provinceId: card.id, name: card.name },
    };
  }
  if (type === "set_resource_allocation") {
    const econ = asRecord(
      await session.call("get_economy", { include: ["allocation"], fresh: true }),
    );
    const setters = Array.isArray(econ?.allocationSetters) ? econ.allocationSetters : [];
    const setter = String(action.setter || "");
    const values = Array.isArray(action.values) ? action.values : null;
    const hit = setters
      .map(asRecord)
      .find((s) => s && String(s.setter) === setter);
    if (!hit || !values) {
      return {
        ...action,
        type,
        valid: false,
        reason: econ?.allocation
          ? "setter name and numeric values are required and must match a discovered setter arity; otherwise capture a HAR"
          : "no allocation slider API; HAR required",
        before: econ?.allocation ?? null,
      };
    }
    if (Number(hit.arity) !== values.length) {
      return {
        ...action,
        type,
        valid: false,
        reason: `setter ${setter} arity ${String(hit.arity)} does not match values length ${values.length}`,
        before: econ?.allocation ?? null,
      };
    }
    return { ...action, type, valid: true, before: econ?.allocation ?? null };
  }
  return { ...action, type, valid: false, reason: `unsupported action type ${type}` };
}

export async function previewActions(
  session: GameSession,
  args: Record<string, unknown>,
): Promise<Preview> {
  const health = await session.health();
  if (!health.gameId) {
    throw new Error("need_ensure_ready: open a game before preview_actions");
  }
  const raw = Array.isArray(args.actions) ? (args.actions as Action[]) : [];
  const actions: PreviewAction[] = [];
  for (const action of raw) actions.push(await describeAction(session, action));
  const preview: Preview = {
    previewId: "prv_" + randomBytes(8).toString("hex"),
    gameId: health.gameId,
    sessionVersion: session.sessionVersion(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    valid: actions.length > 0 && actions.every((a) => a.valid),
    actions,
  };
  previews.set(preview.previewId, preview);
  return preview;
}

function requirePreview(session: GameSession, previewId: string, gameId: number): Preview {
  const preview = previews.get(previewId);
  if (!preview) throw new Error("preview not found");
  if (Date.parse(preview.expiresAt) < Date.now()) throw new Error("preview expired");
  if (preview.gameId !== gameId) {
    throw new Error(
      `preview gameId ${preview.gameId} does not match open game ${gameId}`,
    );
  }
  if (preview.sessionVersion !== session.sessionVersion()) {
    throw new Error("sessionVersion changed since preview — call preview_actions again");
  }
  return preview;
}

export async function executeActions(
  session: GameSession,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const previewId = String(args.previewId || "");
  const health = await session.health();
  if (!health.gameId) throw new Error("need_ensure_ready: no open game");
  const preview = requirePreview(session, previewId, health.gameId);
  if (!preview.valid) throw new Error("preview is not valid — fix actions and preview again");
  preview.preEconomy = await session.call("get_resources", { fresh: true });
  const results: unknown[] = [];
  for (const action of preview.actions) {
    const type = String(action.type || "");
    try {
      if (type === "set_building_enabled") {
        const steps = action.steps || [];
        const stepResults = [];
        for (const step of steps) {
          const sent = await session.call("set_building_enabled", {
            provinceIdOrName: action.provinceIdOrName ?? action.provinceId ?? action.province,
            upgradeId: step.upgradeId,
            enabled: action.enabled,
          });
          const rec = asRecord(sent);
          stepResults.push({
            upgradeId: step.upgradeId,
            accepted: rec?.ok === true,
            clientAfter: rec?.after ?? null,
          });
        }
        results.push({
          type,
          requested: action.enabled,
          accepted: stepResults.every((s) => s.accepted),
          error: stepResults.every((s) => s.accepted) ? null : "client rejected a building toggle",
          steps: stepResults,
        });
        continue;
      }
      if (type === "construct_building") {
        const sent = asRecord(
          await session.call("construct_building", {
            provinceIdOrName: action.provinceIdOrName ?? action.provinceId ?? action.province,
            upgradeId: action.upgradeId,
          }),
        );
        results.push({
          type,
          requested: action.upgradeId,
          accepted: sent?.ok !== false,
          error: sent?.error ?? null,
        });
        continue;
      }
      if (type === "cancel_building") {
        const sent = asRecord(
          await session.call("cancel_building", {
            provinceIdOrName: action.provinceIdOrName ?? action.provinceId ?? action.province,
            slot: action.slot ?? 0,
          }),
        );
        results.push({
          type,
          requested: action.slot ?? 0,
          accepted: sent?.ok !== false,
          error: sent?.error ?? null,
        });
        continue;
      }
      if (type === "produce_unit") {
        const sent = asRecord(
          await session.call("produce_unit", {
            provinceIdOrName: action.provinceIdOrName ?? action.provinceId ?? action.province,
            unitTypeId: action.unitTypeId,
          }),
        );
        results.push({
          type,
          requested: action.unitTypeId,
          accepted: sent?.ok !== false,
          error: sent?.error ?? null,
        });
        continue;
      }
      if (type === "cancel_unit_production") {
        const sent = asRecord(
          await session.call("cancel_unit_production", {
            provinceIdOrName: action.provinceIdOrName ?? action.provinceId ?? action.province,
            slot: action.slot ?? 0,
          }),
        );
        results.push({
          type,
          requested: action.slot ?? 0,
          accepted: sent?.ok !== false,
          error: sent?.error ?? null,
        });
        continue;
      }
      if (type === "set_resource_allocation") {
        const sent = asRecord(
          await session.call("set_allocation", {
            setter: action.setter,
            source: action.source,
            values: action.values,
          }),
        );
        results.push({
          type,
          requested: action.values,
          accepted: sent?.ok === true,
          error: sent?.error ?? null,
        });
        continue;
      }
      results.push({ type, accepted: false, error: "unsupported" });
    } catch (err) {
      results.push({
        type,
        requested: true,
        accepted: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  preview.executed = true;
  return {
    previewId,
    gameId: preview.gameId,
    sessionVersion: preview.sessionVersion,
    results,
    note: "accepted is not verified — call verify_actions",
  };
}

function stocksByName(raw: unknown): Map<string, { production: number | null; consumption: number | null; rate: number | null }> {
  const rec = asRecord(raw);
  const list = Array.isArray(rec?.resources) ? rec.resources : [];
  const map = new Map<string, { production: number | null; consumption: number | null; rate: number | null }>();
  for (const item of list) {
    const row = asRecord(item);
    if (!row?.name) continue;
    map.set(String(row.name).toLowerCase(), {
      production: typeof row.production === "number" ? row.production : null,
      consumption: typeof row.consumption === "number" ? row.consumption : null,
      rate: typeof row.rate === "number" ? row.rate : null,
    });
  }
  return map;
}

export async function verifyActions(
  session: GameSession,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const previewId = String(args.previewId || "");
  const health = await session.health();
  if (!health.gameId) throw new Error("need_ensure_ready: no open game");
  const preview = requirePreview(session, previewId, health.gameId);
  if (!preview.executed) {
    return {
      previewId,
      status: "unknown",
      reason: "execute_actions has not run for this preview",
      actions: [],
    };
  }
  const postEconomy = await session.call("get_resources", { fresh: true });
  const pre = stocksByName(preview.preEconomy);
  const post = stocksByName(postEconomy);
  const observed: Record<string, unknown> = {};
  for (const [name, after] of post) {
    const before = pre.get(name);
    if (!before) continue;
    observed[name] = {
      productionDelta:
        before.production != null && after.production != null
          ? after.production - before.production
          : null,
      consumptionDelta:
        before.consumption != null && after.consumption != null
          ? after.consumption - before.consumption
          : null,
      rateDelta: before.rate != null && after.rate != null ? after.rate - before.rate : null,
    };
  }
  const actions = [];
  for (const action of preview.actions) {
    if (String(action.type) !== "set_building_enabled") {
      actions.push({
        type: action.type,
        status: "unknown",
        reason: "this action type has no independent state read yet",
        economicImpact: { observed, estimated: null },
      });
      continue;
    }
    const card = await provinceCard(session, action);
    const building = card ? matchBuilding(card, action) : null;
    if (!building) {
      actions.push({ type: action.type, status: "unknown", reason: "building not readable" });
      continue;
    }
    const levels = (Array.isArray(building.levels) ? building.levels : [])
      .map(asRecord)
      .filter((l): l is Record<string, unknown> => !!l);
    const wanted = action.steps || [];
    let failed = false;
    let unknown = false;
    for (const step of wanted) {
      const level = levels.find((l) => Number(l.upgradeId) === step.upgradeId);
      if (!level || level.enabledVerified !== true || typeof level.enabled !== "boolean") {
        unknown = true;
        continue;
      }
      if (level.enabled !== action.enabled) failed = true;
    }
    const status = failed ? "failed" : unknown || !wanted.length ? "unknown" : "verified";
    actions.push({
      type: action.type,
      status,
      requested: action.enabled,
      enabled: building.enabled,
      enabledScope: building.enabledScope,
      economicImpact: { observed, estimated: null },
    });
  }
  return { previewId, gameId: preview.gameId, actions };
}
