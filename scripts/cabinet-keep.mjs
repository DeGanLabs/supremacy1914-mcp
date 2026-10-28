/**
 * Keep the game tab bridged: connect over CDP to an already-open Chromium/Chrome
 * (or launch persistent profile), wait for hup, inject browser-console.js,
 * call connectCabinetBridge(url, token), reconnect on close/reload.
 *
 * Usage:
 *   npm run cabinet:keep
 *   CABINET_CDP_URL=http://127.0.0.1:9222 npm run cabinet:keep
 *   CABINET_KEEP_LAUNCH=1 npm run cabinet:keep   # launch Chromium with userDataDir
 *
 * WS stays 127.0.0.1:8765 (cabinet must be running).
 * This process is the actuator keep-alive — not the planner.
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

loadDotenv({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "src", "examples", "browser-console.js");
const wsUrl =
  process.env.CABINET_BRIDGE_WS?.trim() || "ws://127.0.0.1:8765";
const dataDir =
  process.env.CABINET_DATA_DIR?.trim() || path.join(root, "data", "cabinet");
const cdpUrl =
  process.env.CABINET_CDP_URL?.trim() || "http://127.0.0.1:9222";
const launchFallback = process.env.CABINET_KEEP_LAUNCH === "1";
const userDataDir =
  process.env.CABINET_KEEP_PROFILE?.trim() ||
  path.join(root, "data", "cabinet", "playwright-profile");

function resolveKeepToken() {
  const envTok = process.env.CABINET_BRIDGE_TOKEN?.trim() || "";
  if (envTok.length >= 8) return envTok;
  try {
    const fileTok = readFileSync(path.join(dataDir, "bridge.token"), "utf8").trim();
    if (fileTok.length >= 8) return fileTok;
  } catch {
    /* missing */
  }
  throw new Error(
    "no bridge token — start npm run cabinet first (writes data/cabinet/bridge.token) or set CABINET_BRIDGE_TOKEN",
  );
}

async function loadInjectSource() {
  const raw = await readFile(scriptPath, "utf8");
  // Strip possible shebang / ensure we eval the IIFE body.
  return raw;
}

async function findGamePage(browser) {
  const contexts = browser.contexts();
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      const url = page.url();
      if (/supremacy|bytro|s1914|1914/i.test(url)) return page;
    }
  }
  // Prefer any page that already has hup
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      try {
        const has = await page.evaluate(() => typeof window.hup !== "undefined");
        if (has) return page;
      } catch {
        /* cross-origin */
      }
    }
  }
  return contexts[0]?.pages()[0] ?? null;
}

async function waitForHup(page, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await page.evaluate(
        () =>
          typeof window.hup !== "undefined" &&
          !!(window.hup && window.hup.gameState),
      );
      if (ok) return true;
    } catch {
      /* navigating */
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

async function injectAndConnect(page, source, token) {
  await page.evaluate((src) => {
    // eslint-disable-next-line no-eval
    eval(src);
  }, source);
  await page.evaluate(
    ({ url, tok }) => {
      const s = window.s1914;
      if (!s || typeof s.connectCabinetBridge !== "function") {
        throw new Error("s1914.connectCabinetBridge missing after inject");
      }
      return s.connectCabinetBridge(url, tok);
    },
    { url: wsUrl, tok: token },
  );
  console.log(`[cabinet:keep] bridge connected → ${wsUrl}`);
}

async function attachLoop(browser) {
  const source = await loadInjectSource();
  let lastUrl = "";
  for (;;) {
    let page = await findGamePage(browser);
    if (!page) {
      console.warn("[cabinet:keep] no page yet — waiting…");
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    try {
      const url = page.url();
      if (url !== lastUrl) {
        console.log(`[cabinet:keep] watching ${url}`);
        lastUrl = url;
      }
      const ready = await waitForHup(page, 90_000);
      if (!ready) {
        console.warn("[cabinet:keep] hup not ready — retry");
        await page.waitForTimeout(5000);
        continue;
      }
      await injectAndConnect(page, source, resolveKeepToken());
      // Stay attached until page closes or bridge dies
      await Promise.race([
        page.waitForEvent("close").then(() => "close"),
        page.waitForEvent("framenavigated").then(() => "nav"),
        new Promise((r) => setTimeout(() => r("poll"), 60_000)),
      ]);
      console.log("[cabinet:keep] reconnect cycle…");
      await page.waitForTimeout(2000);
    } catch (err) {
      console.warn(
        "[cabinet:keep]",
        err instanceof Error ? err.message : String(err),
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function main() {
  console.log("[cabinet:keep] actuator keep-alive (not the planner)");
  console.log(`[cabinet:keep] CDP ${cdpUrl} · WS ${wsUrl}`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    console.log("[cabinet:keep] attached via CDP");
  } catch (err) {
    if (!launchFallback) {
      console.error(
        "[cabinet:keep] CDP connect failed. Start Chrome with --remote-debugging-port=9222 or set CABINET_KEEP_LAUNCH=1",
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
    console.warn("[cabinet:keep] CDP failed — launching persistent Chromium");
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ["--remote-debugging-port=9222"],
      viewport: null,
    });
    browser = ctx;
    if (!ctx.pages().length) {
      await ctx.newPage();
    }
  }
  await attachLoop(browser);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
