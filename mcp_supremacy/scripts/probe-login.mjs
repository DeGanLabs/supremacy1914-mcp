/**
 * Temp-profile login probe (does not touch /data/profile).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const email = process.env.S1914_EMAIL || "";
const password = process.env.S1914_PASSWORD || "";
const explicitUser =
  process.env.S1914_USERNAME ||
  process.env.S1914_USER ||
  process.env.S1914_PLAYER ||
  "";
const localPart = email.includes("@") ? email.split("@")[0] : "";

const candidates = [...new Set([explicitUser, localPart, email].filter(Boolean))];

console.log(
  JSON.stringify({
    candidates: candidates.map((c) => ({
      len: c.length,
      looksEmail: /@/.test(c),
    })),
    passLen: password.length,
  }),
);

async function tryLogin(loginId) {
  const dir = `/tmp/pw-login-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.mkdirSync(dir, { recursive: true });
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
  await page.waitForTimeout(2000);

  for (const sel of [
    "#onetrust-accept-btn-handler",
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
  ]) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 600 })) await b.click();
    } catch {
      /* ignore */
    }
  }

  await page.locator("#loginbox_login_input").fill(loginId);
  await page.locator("#loginbox_password_input").fill(password);

  // AJAX login button (not a form submit)
  const btn = page.locator("#func_loginbutton");
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
  } else {
    await page.locator(".button_wrapper_dark_bg_button").first().click();
  }

  await page.waitForTimeout(5000);

  const result = await page.evaluate(() => {
    const errEl =
      document.querySelector("#login_error_message") ||
      document.querySelector("#login_error_message_div");
    const body = (document.body?.innerText || "").replace(/\s+/g, " ");
    const invalid = /invalid username or password/i.test(body);
    const err = (errEl?.innerText || "").trim();
    return {
      url: location.href,
      hasPassword: !!document.querySelector("#loginbox_password_input"),
      invalid,
      err,
      body: body.slice(0, 500),
      hasIfm: !!document.getElementById("ifm"),
    };
  });

  if (!result.invalid && result.hasPassword) {
    // maybe soft-redirect needed
    await page
      .goto("https://www.supremacy1914.com/game.php", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(4000);
    const game = await page.evaluate(() => ({
      url: location.href,
      hasPassword: !!document.querySelector("#loginbox_password_input"),
      hasIfm: !!document.getElementById("ifm"),
      body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 400),
    }));
    Object.assign(result, { game });
  }

  await ctx.close();
  const ok =
    !result.invalid &&
    (!result.hasPassword || result.hasIfm || result.game?.hasIfm);
  return { loginIdKind: /@/.test(loginId) ? "email" : "player", ok, result };
}

let anyOk = false;
for (const id of candidates) {
  const r = await tryLogin(id);
  console.log(
    "ATTEMPT",
    JSON.stringify({
      kind: r.loginIdKind,
      ok: r.ok,
      invalid: r.result.invalid,
      err: r.result.err,
      url: r.result.url,
      hasPassword: r.result.hasPassword,
      hasIfm: r.result.hasIfm,
      gameUrl: r.result.game?.url,
      gameHasIfm: r.result.game?.hasIfm,
      bodySnip: r.result.body?.slice(0, 180),
    }),
  );
  if (r.ok) {
    anyOk = true;
    break;
  }
}

console.log("DONE", anyOk ? "LOGGED_IN" : "NOT_LOGGED_IN");
process.exit(anyOk ? 0 : 2);
