import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "src/inject/browser-helpers.js"), "utf8");
const b64 = Buffer.from(src, "utf8").toString("base64");
const size = 20000;
const chunks = [];
for (let i = 0; i < b64.length; i += size) {
  chunks.push(b64.slice(i, i + size));
}
mkdirSync(path.join(root, "data"), { recursive: true });
writeFileSync(
  path.join(root, "data/inject-chunks.json"),
  JSON.stringify({ chunks, count: chunks.length }, null, 0),
);
console.log(JSON.stringify({ count: chunks.length, totalChars: b64.length }));
