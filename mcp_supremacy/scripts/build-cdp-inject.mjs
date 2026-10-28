import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "src/inject/browser-helpers.js"), "utf8");
const expr = `(function(){
  try {
    eval(${JSON.stringify(src)});
    const g = window.s1914 && window.s1914.currentGame ? window.s1914.currentGame() : null;
    return JSON.stringify({
      ok: typeof window.s1914 !== "undefined" && typeof window.s1914.rpc === "function",
      game: g,
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
  }
})()`;

mkdirSync(path.join(root, "data"), { recursive: true });
writeFileSync(
  path.join(root, "data/cdp-inject.json"),
  JSON.stringify({ expression: expr, returnByValue: true }),
);
console.log("wrote data/cdp-inject.json bytes", Buffer.byteLength(expr));
