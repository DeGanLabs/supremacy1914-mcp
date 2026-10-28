/**
 * Download Supremacy 1914 Ultimate client icons into ./assets
 * Source: clients/s1914-client-ultimate/s1914-client-ultimate_live/images/
 *
 * Local layout (curated):
 *   buildings/       — upgrades / portraits / levels
 *   units_weapons/   — units / portraits / features / premium unlock
 *   heroes/          — hero UI + portraits
 *   (other UI stays under original-ish folders)
 */
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO, "assets");
const BASE =
  "https://www.supremacy1914.com/clients/s1914-client-ultimate/s1914-client-ultimate_live/images/";
const META =
  process.env.S1914_IMGPROPS ||
  path.join(process.env.TEMP || "/tmp", "s1914_imgprops.json");

/** Remote client category → local folder under assets/ */
const LOCAL_PATH = {
  units: "units_weapons/icons",
  units_portrait: "units_weapons/portraits",
  unit_features: "units_weapons/features",
  "premiums/unit_unlock": "units_weapons/premium_unlock",
  upgrades: "buildings/icons",
  upgrades_portrait: "buildings/portraits",
  upgrade_levels: "buildings/levels",
  heroes: "heroes",
  "heroes/border": "heroes/border",
  "heroes/levels": "heroes/levels",
  "heroes/rarity": "heroes/rarity",
  "heroes/shards": "heroes/shards",
  "heroes/tutorial": "heroes/tutorial",
  "heroes/unit": "heroes/unit",
};

const INCLUDE = [
  "units",
  "units_portrait",
  "upgrades",
  "upgrades_portrait",
  "upgrade_levels",
  "heroes",
  "heroes/border",
  "heroes/levels",
  "heroes/rarity",
  "heroes/shards",
  "heroes/tutorial",
  "heroes/unit",
  "icons",
  "resources",
  "resources_button",
  "diplomacy",
  "espionage",
  "inventory",
  "unit_features",
  "premiums/unit_unlock",
  "army_details",
  "avatars",
  "chat",
  "game_menu",
  "notification",
  "points",
  "rank",
  "ranking",
  "supply_lines",
  "map/warfare",
  "logo",
];

function localDirFor(cat) {
  return LOCAL_PATH[cat] || cat;
}

if (!fs.existsSync(META)) {
  console.error("Missing image-properties JSON at", META);
  console.error("Parse image-properties.*.js from the live client first.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(META, "utf8"));
const jobs = [];
for (const cat of INCLUDE) {
  const files = data[cat];
  if (!files) {
    console.warn("missing category", cat);
    continue;
  }
  const localCat = localDirFor(cat);
  for (const file of Object.keys(files)) {
    jobs.push({
      url: BASE + cat + "/" + file.split("/").map(encodeURIComponent).join("/"),
      dest: path.join(ROOT, localCat, file),
      cat,
      localCat,
      file,
    });
  }
}

fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "image-properties.selected.json"),
  JSON.stringify(Object.fromEntries(INCLUDE.map((c) => [c, data[c] || {}])), null, 2)
);

const CONCURRENCY = 16;
let done = 0;
let ok = 0;
let fail = 0;
let skip = 0;
const failures = [];

function fetchToFile(url, dest) {
  return new Promise((resolve) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skip++;
      done++;
      return resolve("skip");
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchToFile(res.headers.location, dest).then(resolve);
      }
      if (res.statusCode !== 200) {
        fail++;
        done++;
        failures.push({ url, status: res.statusCode });
        res.resume();
        return resolve("fail");
      }
      const tmp = dest + ".part";
      const ws = fs.createWriteStream(tmp);
      res.pipe(ws);
      ws.on("finish", () => {
        ws.close(() => {
          try {
            fs.renameSync(tmp, dest);
          } catch {
            fs.copyFileSync(tmp, dest);
            fs.unlinkSync(tmp);
          }
          ok++;
          done++;
          resolve("ok");
        });
      });
      ws.on("error", () => {
        fail++;
        done++;
        failures.push({ url, status: "write" });
        try {
          fs.unlinkSync(tmp);
        } catch {}
        resolve("fail");
      });
    });
    req.on("error", () => {
      fail++;
      done++;
      failures.push({ url, status: "net" });
      resolve("fail");
    });
    req.on("timeout", () => {
      req.destroy();
      fail++;
      done++;
      failures.push({ url, status: "timeout" });
      resolve("fail");
    });
  });
}

function walk(dir, prefix = "") {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(p).isDirectory()) out.push(...walk(p, rel));
    else out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}

async function run() {
  console.log("jobs", jobs.length, "->", ROOT);
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const j = jobs[i++];
      await fetchToFile(j.url, j.dest);
      if (done % 50 === 0 || done === jobs.length) {
        process.stdout.write(`\r${done}/${jobs.length} ok=${ok} skip=${skip} fail=${fail}   `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log("\nDone", { ok, skip, fail, total: jobs.length });
  fs.writeFileSync(
    path.join(ROOT, "download-report.json"),
    JSON.stringify({ ok, skip, fail, total: jobs.length, failures: failures.slice(0, 200) }, null, 2)
  );
  const manifest = {};
  for (const cat of INCLUDE) {
    manifest[cat] = walk(path.join(ROOT, cat));
  }
  fs.writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
}

await run();
