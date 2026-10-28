/**
 * Dump Ultimate camera / map pan APIs inside #ifm.
 * Run via MCP page evaluate or:
 *   docker exec -w /app mcp_supremacy_mcp node -e "..." 
 *
 * Prefer using ensure_ready then inject center_map; this script is for discovery.
 */
console.log(
  JSON.stringify({
    note: "Call via Playwright page.evaluate in a live game session",
    snippet: `(() => {
  const ifm = document.getElementById("ifm");
  const w = ifm && ifm.contentWindow;
  const hup = w && w.hup;
  if (!hup) return { error: "no hup" };
  const pick = (obj, depth) => {
    if (!obj || depth > 1) return null;
    const keys = [];
    try {
      keys.push(...Object.keys(obj));
      keys.push(...Object.getOwnPropertyNames(Object.getPrototypeOf(obj) || {}));
    } catch (e) {}
    return [...new Set(keys)].filter((k) =>
      /camera|zoom|scroll|center|pan|view|mapController|renderer/i.test(k),
    );
  };
  return {
    top: pick(hup, 0),
    mapController: pick(hup.mapController, 0),
    camera: pick(hup.camera || hup.mapCamera, 0),
    gameView: pick(hup.gameView || hup.mapView || hup.view, 0),
    provinceController: pick(hup.provinceController, 0),
  };
})()`,
  }),
);
