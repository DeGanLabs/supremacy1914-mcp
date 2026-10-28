/**
 * Probe Ultimate client for Operations / Hero Pass APIs.
 * Usage: node scripts/probe-operations.mjs
 * Assumes MCP at 127.0.0.1:8789 with a game already open (or will ensure_ready).
 */
const BASE = process.env.S1914_MCP_URL || "http://127.0.0.1:8789";
const GAME = Number(process.env.S1914_GAME_ID || process.env.S1914_SMOKE_GAME_ID);
if (!Number.isFinite(GAME) || GAME <= 0) {
  throw new Error("Set S1914_GAME_ID (or S1914_SMOKE_GAME_ID) to your joined map id");
}

async function call(name, args = {}) {
  const res = await fetch(`${BASE}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 400));
  }
  if (!json.ok && json.error) throw new Error(json.error);
  return json.result ?? json;
}

const probeSrc = `
(() => {
  const ifm = document.getElementById("ifm");
  const w = ifm && ifm.contentWindow;
  const hup = w && w.hup;
  if (!hup) return { error: "no hup" };
  function names(obj) {
    const out = [];
    let o = obj;
    let d = 0;
    while (o && d < 4) {
      try {
        out.push.apply(out, Object.getOwnPropertyNames(o));
      } catch (e) {}
      o = Object.getPrototypeOf(o);
      d++;
    }
    return [...new Set(out)].filter((n) => /operat|battle|pass|hero|reward|mission|challenge|quest|event|season/i.test(n)).sort();
  }
  function safe(fn) {
    try {
      const v = fn();
      if (v == null) return null;
      if (typeof v === "object") {
        try {
          return JSON.parse(JSON.stringify(v));
        } catch (e) {
          return String(v);
        }
      }
      return v;
    } catch (e) {
      return "ERR:" + (e && e.message ? e.message : e);
    }
  }
  const uiKeys = names(hup.ui || {});
  const gsKeys = names(hup.gameState || {});
  const topKeys = names(hup);
  const hits = {};
  const controllers = [];
  const ui = hup.ui || {};
  for (const k of Object.keys(ui)) {
    if (/operat|battle|pass|hero|reward|challenge|quest|event|season/i.test(k)) {
      controllers.push(k);
      const c = ui[k];
      hits["ui." + k] = {
        type: typeof c,
        methods: typeof c === "object" && c ? names(c).slice(0, 40) : [],
      };
    }
  }
  for (const k of Object.keys(hup)) {
    if (/operat|battle|pass|hero|reward|challenge|quest|event|season/i.test(k)) {
      controllers.push("hup." + k);
      const c = hup[k];
      hits["hup." + k] = {
        type: typeof c,
        methods: typeof c === "object" && c ? names(c).slice(0, 40) : [],
      };
    }
  }
  // Try common getters
  const tries = {};
  const candidates = [
    ["hup.operationsController", () => hup.operationsController],
    ["hup.ui.operationsController", () => ui.operationsController],
    ["hup.ui.operationController", () => ui.operationController],
    ["hup.ui.battlePassController", () => ui.battlePassController],
    ["hup.ui.heroPassController", () => ui.heroPassController],
    ["hup.ui.eventController", () => ui.eventController],
    ["hup.gameState.getOperationsState", () => hup.gameState.getOperationsState && hup.gameState.getOperationsState()],
    ["hup.gameState.getEventState", () => hup.gameState.getEventState && hup.gameState.getEventState()],
    ["hup.gameState.getBattlePassState", () => hup.gameState.getBattlePassState && hup.gameState.getBattlePassState()],
  ];
  for (const [label, fn] of candidates) {
    tries[label] = safe(fn);
  }
  return {
    topKeys,
    uiKeys,
    gsKeys,
    controllers,
    hits,
    tries,
  };
})()
`;

const ensure = await call("ensure_ready", { gameId: GAME });
console.log("ensure", JSON.stringify({ ok: ensure.ok, gameId: ensure.gameId, error: ensure.error }));
if (!ensure.ok) {
  const ensure2 = await call("ensure_ready", { gameId: GAME });
  console.log("ensure2", JSON.stringify({ ok: ensure2.ok, gameId: ensure2.gameId, error: ensure2.error }));
}

// Inject probe via a one-off evaluate through health path is hard; use dump via temporary tool.
// Hotpatch: call get_connector_capabilities after we add probe to rpc — for now use docker exec playwright-less path.
console.log(JSON.stringify({ note: "write probe into helpers next" }));
