import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chunks } = JSON.parse(
  readFileSync(path.join(root, "data/inject-chunks.json"), "utf8"),
);
const out = path.join(root, "data");
mkdirSync(out, { recursive: true });

writeFileSync(
  path.join(out, "cdp0.json"),
  JSON.stringify({
    expression: "window.__s1914b64=''; 'reset'",
    returnByValue: true,
  }),
);

chunks.forEach((ch, i) => {
  writeFileSync(
    path.join(out, `cdp${i + 1}.json`),
    JSON.stringify({
      expression: `window.__s1914b64=(window.__s1914b64||"")+${JSON.stringify(ch)}; String(window.__s1914b64.length)`,
      returnByValue: true,
    }),
  );
});

writeFileSync(
  path.join(out, "cdp-final.json"),
  JSON.stringify({
    expression: `(function(){
  try {
    var s = atob(window.__s1914b64);
    eval(s);
    var g = window.s1914 && window.s1914.currentGame && window.s1914.currentGame();
    return JSON.stringify({
      ok: !!(window.s1914 && window.s1914.rpc),
      game: g,
      b64len: (window.__s1914b64 || "").length
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
  }
})()`,
    returnByValue: true,
  }),
);

console.log(`wrote cdp0..cdp${chunks.length} + cdp-final`);
