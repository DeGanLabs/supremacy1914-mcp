/**
 * Inspect login form submit controls (temp profile).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const dir = `/tmp/pw-form-${Date.now()}`;
fs.mkdirSync(dir, { recursive: true });
const ctx = await chromium.launchPersistentContext(dir, {
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://www.supremacy1914.com/", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const form = document.getElementById("func_loginbox_form");
  const html = form?.outerHTML?.slice(0, 2500) || null;
  const allLogin = [...document.querySelectorAll("*")].filter((el) => {
    const id = el.id || "";
    const cls = typeof el.className === "string" ? el.className : "";
    const onclick = el.getAttribute?.("onclick") || "";
    return /login/i.test(id + " " + cls + " " + onclick);
  });
  return {
    formHtml: html,
    loginEls: allLogin.slice(0, 40).map((el) => ({
      tag: el.tagName,
      id: el.id,
      cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
      onclick: (el.getAttribute("onclick") || "").slice(0, 160),
      href: el.getAttribute?.("href") || null,
      text: (el.innerText || "").trim().slice(0, 40),
    })),
  };
});
console.log(JSON.stringify(info, null, 2));
await ctx.close();
