/**
 * Check whether /data/profile already has a logged-in session.
 * Uses a COPY of the profile so the running MCP Chromium keeps the lock.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import { execSync } from "node:child_process";

const src = "/data/profile";
const dir = `/tmp/pw-profile-copy-${Date.now()}`;

function copyProfile() {
  fs.mkdirSync(dir, { recursive: true });
  // Prefer rsync/cp; skip Singleton locks so we can open the copy
  try {
    execSync(`cp -a ${src}/. ${dir}/`, { stdio: "pipe" });
  } catch (e) {
    console.log("COPY_WARN", String(e));
  }
  for (const f of [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    "lockfile",
  ]) {
    try {
      fs.rmSync(`${dir}/${f}`, { force: true });
    } catch {
      /* ignore */
    }
  }
  console.log(
    "PROFILE_COPY",
    JSON.stringify({
      srcExists: fs.existsSync(src),
      destEntries: fs.existsSync(dir) ? fs.readdirSync(dir).slice(0, 30) : [],
    }),
  );
}

copyProfile();

const ctx = await chromium.launchPersistentContext(dir, {
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  viewport: { width: 1400, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());

await page.goto("https://www.supremacy1914.com/", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(2500);

const home = await page.evaluate(() => ({
  url: location.href,
  hasPassword: !!document.querySelector("#loginbox_password_input"),
  body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 700),
  hasLogout: /log\s*out|abmelden/i.test(document.body?.innerText || ""),
}));
console.log("HOME", JSON.stringify(home));

await page
  .goto("https://www.supremacy1914.com/game.php", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  })
  .catch(() => undefined);
await page.waitForTimeout(5000);

const game = await page.evaluate(() => ({
  url: location.href,
  hasIfm: !!document.getElementById("ifm"),
  hasPassword: !!document.querySelector("#loginbox_password_input"),
  title: document.title,
  body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 700),
}));
console.log("GAME", JSON.stringify(game));

const cookies = await ctx.cookies();
const authish = cookies.filter((c) =>
  /sess|auth|token|login|user|sid|php/i.test(c.name),
);
console.log(
  "AUTH_COOKIES",
  JSON.stringify(authish.map((c) => ({ name: c.name, domain: c.domain }))),
);
console.log(
  "ALL_COOKIE_NAMES",
  JSON.stringify(cookies.map((c) => c.name)),
);

const loggedIn = !game.hasPassword && (game.hasIfm || !/login/i.test(game.body));
console.log("PROFILE_LOGGED_IN", loggedIn);

await ctx.close();
process.exit(loggedIn ? 0 : 2);
