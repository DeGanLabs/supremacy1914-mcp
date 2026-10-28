import type { Page } from "playwright";

export interface LoginCredentials {
  /** Player name (preferred) or email — site login box placeholder is "Player name". */
  readonly email: string;
  readonly password: string;
}

export function credentialsFromEnv(): LoginCredentials | null {
  const email =
    process.env.S1914_USERNAME?.trim() ||
    process.env.S1914_USER?.trim() ||
    process.env.S1914_PLAYER?.trim() ||
    process.env.S1914_EMAIL?.trim() ||
    "";
  const password = process.env.S1914_PASSWORD?.trim() || "";
  if (!email || !password) return null;
  return { email, password };
}

/** True when the page looks like a login / lobby without an Ultimate client iframe. */
export async function needsLogin(page: Page): Promise<boolean> {
  try {
    const state = await page.evaluate(() => {
      const ifm = document.getElementById("ifm") as HTMLIFrameElement | null;
      const hup = ifm?.contentWindow
        ? (ifm.contentWindow as Window & { hup?: { gameState?: unknown } }).hup
        : undefined;
      const hasHup = !!(hup && hup.gameState);
      const body = (document.body?.innerText || "").slice(0, 2000).toLowerCase();
      const hasLoginBox =
        !!document.querySelector("#loginbox_password_input") ||
        !!document.querySelector("#loginbox_login_input");
      const hasPassword =
        hasLoginBox ||
        !!document.querySelector('input[type="password"]') ||
        !!document.querySelector('input[name="pass"]') ||
        !!document.querySelector('input[name="password"]');
      const invalidCreds = /invalid username or password/.test(body);
      const loginish =
        hasPassword ||
        invalidCreds ||
        /sign in|log in|anmelden|einloggen|password|passwort/.test(body);
      return { hasHup, loginish };
    });
    if (state.hasHup) return false;
    return state.loginish;
  } catch {
    return true;
  }
}

async function acceptCookies(page: Page): Promise<void> {
  for (const sel of [
    "#onetrust-accept-btn-handler",
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Akzeptieren")',
    'button:has-text("Agree")',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) await btn.click();
    } catch {
      /* ignore */
    }
  }
}

async function readLoginError(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el =
      document.querySelector("#login_error_message") ||
      document.querySelector("#login_error_message_div");
    const fromEl = (el?.textContent || "").trim();
    if (fromEl) return fromEl;
    const body = document.body?.innerText || "";
    const m = body.match(/invalid username or password\.?/i);
    return m ? m[0] : "";
  });
}

/**
 * Best-effort site login. Selectors match the current supremacy1914.com loginbox
 * (#loginbox_login_input / #loginbox_password_input / #func_loginbutton AJAX).
 */
export async function attemptLogin(
  page: Page,
  creds: LoginCredentials,
): Promise<{ ok: boolean; detail: string }> {
  const loginUrls = [
    process.env.S1914_LOGIN_URL?.trim(),
    "https://www.supremacy1914.com/",
    "https://www.supremacy1914.de/",
    "https://www.supremacy1914.com/index.php?L=0",
    "https://www.supremacy1914.de/index.php?L=1",
  ].filter(Boolean) as string[];

  let lastDetail = "auto-login failed";

  for (const url of loginUrls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1500);
      await acceptCookies(page);

      // Prefer the real loginbox — never the hidden forgot-password field.
      const user = page.locator("#loginbox_login_input");
      const pass = page.locator(
        "#loginbox_password_input, input[name='pass'][type='password']",
      );

      if (!(await user.isVisible({ timeout: 2000 }).catch(() => false))) {
        for (const sel of [
          "#loginbox_open_close",
          'a:has-text("Login")',
          'a:has-text("Log in")',
          'a:has-text("Anmelden")',
          'button:has-text("Login")',
          'button:has-text("Anmelden")',
        ]) {
          try {
            const b = page.locator(sel).first();
            if (await b.isVisible({ timeout: 500 })) {
              await b.click();
              await page.waitForTimeout(800);
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (!(await pass.isVisible({ timeout: 5000 }).catch(() => false))) {
        lastDetail = `no loginbox on ${url}`;
        continue;
      }

      await user.fill(creds.email, { timeout: 5000 });
      await pass.fill(creds.password);

      // Login is an AJAX div click, not a <button type=submit>.
      let clicked = false;
      for (const sel of [
        "#func_loginbutton",
        "#loginbutton_cont .button_wrapper_dark_bg_button",
        "#loginbutton_cont",
      ]) {
        try {
          const b = page.locator(sel).first();
          if (await b.isVisible({ timeout: 800 })) {
            await b.click();
            clicked = true;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      if (!clicked) {
        await pass.press("Enter");
      }

      await page.waitForTimeout(4500);

      const err = await readLoginError(page);
      if (/invalid username or password/i.test(err)) {
        return {
          ok: false,
          detail:
            "Invalid username or password — set S1914_USERNAME to your in-game player name (not email) and S1914_PASSWORD",
        };
      }

      if (!(await needsLogin(page))) {
        return { ok: true, detail: `logged in via ${url}` };
      }

      await page
        .goto(
          process.env.S1914_GAME_URL?.trim() ||
            "https://www.supremacy1914.com/game.php",
          { waitUntil: "domcontentloaded", timeout: 60_000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(3000);
      if (!(await needsLogin(page))) {
        return { ok: true, detail: `session ok after ${url}` };
      }
      lastDetail = `still on login after ${url}${err ? ` (${err})` : ""}`;
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    ok: false,
    detail:
      lastDetail ||
      "auto-login failed — set S1914_USERNAME (player name) + S1914_PASSWORD, or log in once in the Playwright window",
  };
}
