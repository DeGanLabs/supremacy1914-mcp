import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameSession } from "../src/session.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(root, ".env"), override: true });

const EXPR = `(() => {
  const ifm = document.getElementById("ifm");
  const hup = ifm.contentWindow.hup;
  const hsm = hup.heroSystemManager;
  const raw = hsm.getHeroItems() || [];
  const items = Array.isArray(raw) ? raw : Object.values(raw);

  function keysOf(obj) {
    const out = new Set();
    let cur = obj;
    let depth = 0;
    while (cur && depth < 6) {
      Object.getOwnPropertyNames(cur).forEach(function (k) { out.add(k); });
      cur = Object.getPrototypeOf(cur);
      depth++;
    }
    return Array.from(out).sort();
  }

  function sample(it) {
    const cfg = it.getHeroConfig && it.getHeroConfig();
    const name = cfg && cfg.getName && cfg.getName();
    const shortName = cfg && cfg.getShortName && cfg.getShortName();
    const calls = {};
    keysOf(it).forEach(function (k) {
      if (/^(is|has|can|get)/i.test(k) && typeof it[k] === "function") {
        try {
          const v = it[k]();
          if (typeof v === "boolean" || typeof v === "number" || v == null || typeof v === "string") {
            calls[k] = v;
          }
        } catch (e) {
          calls[k] = "ERR:" + String(e && e.message ? e.message : e);
        }
      }
    });
    ["amount", "count", "owned", "unlocked", "baseUnitTypeId", "itemID", "deploymentMoraleThreshold"].forEach(function (f) {
      if (it[f] !== undefined) calls["field:" + f] = it[f];
    });
    return { itemId: it.itemID || (it.getItemID && it.getItemID()), name: name, shortName: shortName, calls: calls };
  }

  const named = items.map(sample).filter(function (h) {
    return /allenby|callahan|hank/i.test(String(h.name || "")) ||
      /allenby|callahan|hank/i.test(String(h.shortName || ""));
  });

  const mgrMethods = keysOf(hsm).filter(function (k) { return typeof hsm[k] === "function"; });
  const mgrCalls = {};
  mgrMethods.forEach(function (k) {
    if (/^(get|is|has|can)/i.test(k) && !/HeroItems|ByUnit|ByItem/i.test(k)) {
      try {
        const v = hsm[k]();
        if (typeof v === "boolean" || typeof v === "number" || typeof v === "string" || v == null) mgrCalls[k] = v;
        else if (Array.isArray(v)) mgrCalls[k] = { type: "array", len: v.length };
      } catch (e) {}
    }
  });

  const map = hup.gameState.getMapState();
  const own = map.getPlayerProvinces(hup.config.userData.playerID) || [];
  const alpha = own.find(function (p) { return p.getName && p.getName() === "Bridgehead Alpha"; });
  const alphaIds = alpha ? {
    name: alpha.getName(),
    locationID: alpha.getLocationID && alpha.getLocationID(),
    provinceID: alpha.getProvinceID && alpha.getProvinceID()
  } : null;

  return { mgrCalls: mgrCalls, named: named, alphaIds: alphaIds, totalItems: items.length };
})()`;

async function main() {
  const session = new GameSession();
  try {
    const gameId = Number(process.env.S1914_SMOKE_GAME_ID || process.env.S1914_GAME_ID);
    if (!Number.isFinite(gameId) || gameId <= 0) {
      throw new Error("Set S1914_SMOKE_GAME_ID (or S1914_GAME_ID) to your joined map id");
    }
    await session.ensureReady({ gameId });
    const page = (session as unknown as { page: import("playwright").Page }).page;
    const result = await page.evaluate(EXPR);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.stop().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
