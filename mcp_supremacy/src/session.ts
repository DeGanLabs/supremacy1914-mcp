import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { mkdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attemptLogin,
  credentialsFromEnv,
  needsLogin,
} from "./login.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROFILE = path.join(PKG_ROOT, "data", "profile");
const INJECT_PATH = path.join(PKG_ROOT, "src", "inject", "browser-helpers.js");
const DEFAULT_GAME_URL =
  process.env.S1914_GAME_URL?.trim() ||
  "https://www.supremacy1914.com/game.php";

/** ChatGPT MCP often times out ~60s — keep open/ready well under that. */
function readyTimeoutMs(): number {
  const n = Number(process.env.S1914_READY_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 5_000) return Math.floor(n);
  return 22_000;
}

export interface SessionStatus {
  connected: boolean;
  loggedIn: boolean;
  hupReady: boolean;
  gameId: number | null;
  playerId: number | null;
  siteUserId: number | null;
  pageUrl: string | null;
  mode: "persistent" | "cdp";
  injectOk: boolean;
}

/** hup lives inside iframe#ifm, not the parent window. */
const HUP_PROBE = `(() => {
  const ifm = document.getElementById("ifm");
  const w = ifm && ifm.contentWindow;
  const hup = w && w.hup;
  const ud = hup && hup.config && hup.config.userData;
  let mapReady = false;
  try {
    const map = hup && hup.gameState && hup.gameState.getMapState && hup.gameState.getMapState();
    mapReady = !!(map && typeof map.getPlayerProvinces === "function");
  } catch (e) {}
  return {
    hupReady: !!(hup && hup.gameState),
    mapReady: mapReady,
    gameId: ud ? ud.gameID : null,
    playerId: ud ? ud.playerID : null,
    siteUserId: ud ? ud.siteUserID : null,
  };
})()`;

export class ToolOpError extends Error {
  constructor(
    readonly code:
      | "queue_busy"
      | "op_timeout"
      | "map_not_ready"
      | "need_ensure_ready",
    message: string,
    readonly hint: string,
  ) {
    super(`${code}: ${message}. ${hint}`);
    this.name = "ToolOpError";
  }
}

type QueuedOp = {
  label: string;
  timeoutMs: number;
  fn: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  abandoned: boolean;
  started: boolean;
  waitTimer: ReturnType<typeof setTimeout>;
};

export class GameSession {
  private browser: Browser | BrowserContext | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private injectSource: string | null = null;
  private mode: "persistent" | "cdp" = "persistent";
  private started = false;
  private keepTimer: ReturnType<typeof setInterval> | null = null;
  private jobs: QueuedOp[] = [];
  private pumping = false;
  private inFlight: string | null = null;
  private needsRecover = false;
  private version = 0;
  private generation = 0;
  private stage = "idle";

  /** Bumps when a game is successfully opened so previews cannot run on another map. */
  bumpSession(): number {
    this.version += 1;
    return this.version;
  }

  sessionVersion(): number {
    return this.version;
  }

  isBusy(): boolean {
    return this.pumping || this.jobs.length > 0 || this.inFlight != null;
  }

  inFlightLabel(): string | null {
    return this.inFlight;
  }

  /**
   * One Playwright worker. Callers waiting >8s are rejected immediately
   * (queue_busy) so ChatGPT retries don't stack into a black hole.
   */
  enqueue<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    const waitMs = Number(process.env.S1914_QUEUE_WAIT_MS || 8000);
    return new Promise<T>((resolve, reject) => {
      const job: QueuedOp = {
        label,
        timeoutMs,
        fn: fn as () => Promise<unknown>,
        resolve: (v) => resolve(v as T),
        reject,
        abandoned: false,
        started: false,
        waitTimer: setTimeout(() => {
          if (!job.started) {
            job.abandoned = true;
            reject(
              new ToolOpError(
                "queue_busy",
                `waited >${waitMs}ms behind ${this.inFlight ?? "another tool"}`,
                "Retry this one tool after the current call finishes. Do not fire tools in parallel.",
              ),
            );
          }
        }, Number.isFinite(waitMs) && waitMs >= 1000 ? waitMs : 8000),
      };
      this.jobs.push(job);
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        clearTimeout(job.waitTimer);
        if (job.abandoned) continue;
        job.started = true;
        this.inFlight = job.label;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        try {
          if (this.needsRecover) {
            await this.recoverSession();
          }
          const work = job.fn();
          work.catch(() => undefined);
          const result = await Promise.race([
            work,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                timedOut = true;
                reject(
                  new ToolOpError(
                    "op_timeout",
                    `${job.label} exceeded ${job.timeoutMs}ms during ${this.stage}`,
                    "Retry once. If it repeats, call ensure_ready({ gameId }) alone, then one read.",
                  ),
                );
              }, job.timeoutMs);
            }),
          ]);
          this.needsRecover = false;
          job.resolve(result);
        } catch (err) {
          if (timedOut) {
            const pageOpen = !!(this.page && !this.page.isClosed());
            if (pageOpen && this.stage !== "launch_browser") {
              // Leave Chromium up so the retry reuses the same profile instead of relaunching.
              this.generation += 1;
              this.started = true;
              this.needsRecover = false;
            } else {
              this.needsRecover = true;
              await this.releaseBrowser();
            }
          }
          job.reject(err);
        } finally {
          if (timer) clearTimeout(timer);
          this.inFlight = null;
        }
      }
    } finally {
      this.pumping = false;
      if (this.jobs.length) void this.pump();
    }
  }

  private async recoverSession(): Promise<void> {
    this.needsRecover = false;
    await this.releaseBrowser();
  }

  /** Close Playwright's browser so /data/profile is not left locked. */
  private async releaseBrowser(): Promise<void> {
    this.generation += 1;
    this.stopKeepAlive();
    const ctx = this.context;
    const browser = this.browser;
    const mode = this.mode;
    this.page = null;
    this.context = null;
    this.browser = null;
    this.started = false;
    try {
      if (mode === "cdp" && browser && browser !== ctx && "close" in browser) {
        await (browser as Browser).close();
      } else if (ctx) {
        await Promise.race([
          ctx.close(),
          new Promise((resolve) => setTimeout(resolve, 8_000)),
        ]);
      }
    } catch {
      /* the profile lock check handles a leftover process */
    }
  }

  private profileLockOwner(): { host: string; pid: number } | null {
    try {
      const target = readlinkSync(path.join(this.profileDir, "SingletonLock"));
      const match = target.match(/^(.*)-(\d+)$/);
      if (!match) return null;
      return { host: match[1], pid: Number(match[2]) };
    } catch {
      return null;
    }
  }

  private pidAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  private chromeHoldsProfile(pid: number): boolean {
    try {
      const text = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").replace(/\0/g, " ");
      return /chrome/i.test(text) && text.includes(this.profileDir);
    } catch {
      return false;
    }
  }

  private clearStaleProfileLocks(): void {
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      rmSync(path.join(this.profileDir, name), { force: true });
    }
  }

  /**
   * Launch only when this process does not already hold the profile.
   * A live Chromium is stopped. Lock files are removed only after it is gone,
   * or when the lock names a dead pid / another host.
   */
  private async prepareProfileForLaunch(): Promise<string> {
    const owner = this.profileLockOwner();
    if (!owner) return "no_lock";
    const live =
      owner.host === hostname() &&
      this.pidAlive(owner.pid) &&
      this.chromeHoldsProfile(owner.pid);
    if (!live) {
      this.clearStaleProfileLocks();
      return "cleared_stale_lock";
    }
    try {
      process.kill(owner.pid, "SIGTERM");
    } catch {
      /* already exiting */
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && this.pidAlive(owner.pid)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.pidAlive(owner.pid)) {
      try {
        process.kill(owner.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (this.pidAlive(owner.pid) && this.chromeHoldsProfile(owner.pid)) {
      throw new Error(
        `profile_busy: Chromium pid ${owner.pid} on ${owner.host} still holds ${this.profileDir}`,
      );
    }
    this.clearStaleProfileLocks();
    return "stopped_orphan_chrome";
  }

  constructor(
    private readonly profileDir = process.env.S1914_MCP_PROFILE?.trim() ||
      DEFAULT_PROFILE,
    private readonly cdpUrl = process.env.S1914_CDP_URL?.trim() || "",
    private readonly startUrl = DEFAULT_GAME_URL,
  ) {}

  async ensureStarted(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      this.started = true;
      return;
    }
    if (this.context) {
      try {
        this.page = await this.findOrOpenGamePage();
        this.started = true;
        this.startKeepAlive();
        return;
      } catch {
        await this.releaseBrowser();
      }
    }
    await this.start({ soft: true });
  }

  /**
   * Launch browser. soft=true does not throw if hup missing (login may be needed).
   */
  async start(opts?: { soft?: boolean }): Promise<void> {
    this.injectSource = await readFile(INJECT_PATH, "utf8");

    if (this.cdpUrl) {
      this.mode = "cdp";
      const browser = await chromium.connectOverCDP(this.cdpUrl);
      this.browser = browser;
      this.context = browser.contexts()[0] ?? (await browser.newContext());
    } else {
      this.mode = "persistent";
      mkdirSync(this.profileDir, { recursive: true });
      const gen = this.generation;
      const launch = () =>
        chromium.launchPersistentContext(this.profileDir, {
          headless: process.env.S1914_MCP_HEADLESS === "1",
          viewport: null,
          args: ["--disable-blink-features=AutomationControlled"],
        });
      let ctx: BrowserContext;
      try {
        await this.prepareProfileForLaunch();
        ctx = await launch();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/existing browser session|profile appears to be in use|profile_busy|SingletonLock/i.test(message)) {
          throw err;
        }
        await this.prepareProfileForLaunch();
        ctx = await launch();
      }
      if (gen !== this.generation) {
        await ctx.close().catch(() => undefined);
        throw new Error("browser launch cancelled");
      }
      this.browser = ctx;
      this.context = ctx;
      if (!ctx.pages().length) {
        await ctx.newPage();
      }
    }

    this.page = await this.findOrOpenGamePage();
    this.started = true;
    this.startKeepAlive();

    const ready = await this.isHupReady(this.page);
    if (ready) {
      await this.inject(this.page);
      return;
    }
    if (!opts?.soft) {
      throw new Error(
        "hup not ready — call ensure_ready / login, or open a game in the browser window",
      );
    }
  }

  async stop(): Promise<void> {
    await this.releaseBrowser();
  }

  /**
   * Full agent bootstrap: browser â†’ optional auto-login â†’ optional gameId â†’ inject.
   */
  async ensureReady(opts?: {
    gameId?: number;
    login?: boolean;
  }): Promise<
    SessionStatus & { ok: boolean; steps: string[]; error?: string; sessionVersion?: number }
  > {
    const steps: string[] = [];
    try {
      this.stage = "launch_browser";
      steps.push("launch_browser");
      await this.ensureStarted();
      const page = this.requirePage();
      steps.push("browser_up");
      this.stage = "login";

      let hup = await this.isHupReady(page);
      if (!hup && (opts?.login !== false)) {
        const creds = credentialsFromEnv();
        if (creds && (await needsLogin(page))) {
          steps.push("auto_login_attempt");
          const login = await attemptLogin(page, creds);
          steps.push(login.ok ? `login_ok:${login.detail}` : `login_fail:${login.detail}`);
          this.page = page;
        } else if (await needsLogin(page)) {
          steps.push("needs_manual_login");
        }
      }

      // ChatGPT MCP often times out ~60s — keep ready budget under that.
      const readyBudget = readyTimeoutMs();

      if (opts?.gameId != null && Number.isFinite(opts.gameId)) {
        this.stage = "open_game";
        steps.push(`open_game:${opts.gameId}`);
        const opened = await this.openGame(Number(opts.gameId), {
          readyTimeoutMs: readyBudget,
        });
        if (!opened.ok) {
          return {
            ...opened,
            ok: false,
            steps: [...steps, ...(opened.error ? [`open_fail:${opened.error}`] : [])],
            error: opened.error || "open_game incomplete — retry ensure_ready",
          };
        }
      } else {
        // Prefer game.php if we only have lobby
        if (!/game\.php/i.test(page.url())) {
          await page.goto(this.startUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          steps.push("goto_game_php");
        }
        this.stage = "wait_map";
        await this.waitForGameReady(page, readyBudget).catch(() => undefined);
      }

      this.stage = "inject";
      hup = await this.isHupReady(this.requirePage());
      const mapOk = await this.isMapReady(this.requirePage());
      if (!hup || !mapOk) {
        return {
          ok: false,
          steps,
          error: !hup
            ? "still no hup — log in (S1914_EMAIL/PASSWORD or manual once), then ensure_ready with gameId"
            : "hup up but mapState not ready — retry ensure_ready in a few seconds",
          ...(await this.healthRaw()),
        };
      }

      await this.inject(this.requirePage());
      steps.push("inject_ok");
      this.stage = "ready";

      const st = await this.healthRaw();
      const sessionVersion =
        opts?.gameId != null ? this.sessionVersion() : this.bumpSession();
      return { ok: true, steps, sessionVersion, ...st };
    } catch (err) {
      return {
        ok: false,
        steps,
        error: err instanceof Error ? err.message : String(err),
        ...(await this.healthRaw()),
      };
    }
  }

  async login(): Promise<{ ok: boolean; detail: string; health: SessionStatus }> {
    await this.ensureStarted();
    const creds = credentialsFromEnv();
    if (!creds) {
      return {
        ok: false,
        detail: "set S1914_EMAIL and S1914_PASSWORD in mcp_supremacy/.env",
        health: await this.healthRaw(),
      };
    }
    const page = this.requirePage();
    const result = await attemptLogin(page, creds);
    if (result.ok) {
      await this.waitForHup(page, 60_000).catch(() => undefined);
      if (await this.isHupReady(page)) await this.inject(page);
    }
    return { ...result, health: await this.healthRaw() };
  }

  /**
   * Pan/zoom map (via inject centerMap), screenshot #ifm, store expiring PNG URL.
   */
  async mapScreenshot(args: Record<string, unknown> = {}): Promise<{
    ok: boolean;
    url: string;
    expiresAt: string;
    ttlSec: number;
    focus: Record<string, unknown>;
    gameId: number | null;
    caption: string | null;
    markdown: string;
  }> {
    // Xvfb/swiftshader: Page.captureScreenshot + Playwright screenshot hang and
    // block the exclusive tool queue (ChatGPT then times out on everything).
    // Disabled until a non-blocking capture path exists.
    void args;
    throw new Error(
      "map_screenshot disabled under Xvfb (capture hangs) — use get_war_picture / get_own_armies / get_resources instead",
    );
  }

  /** Deep-link into a game, wait for iframe hup + map, reinject. */
  async openGame(
    gameId: number,
    opts?: { readyTimeoutMs?: number },
  ): Promise<SessionStatus & { ok: boolean; error?: string; sessionVersion?: number }> {
    await this.ensureStarted();
    const page = this.requirePage();
    const budget = opts?.readyTimeoutMs ?? readyTimeoutMs();
    const base =
      process.env.S1914_GAME_URL?.trim() ||
      (page.url().includes("supremacy1914.de")
        ? "https://www.supremacy1914.de/game.php"
        : "https://www.supremacy1914.com/game.php");
    const url = `${base.split("#")[0]}#/game/:gameID=${gameId}`;

    // Already on this map with hup+map â†’ skip slow reload (helps ChatGPT retries).
    const cur = await this.healthRaw();
    if (
      cur.hupReady &&
      cur.gameId === gameId &&
      (await this.isMapReady(page))
    ) {
      await this.inject(page).catch(() => undefined);
      const st = await this.healthRaw();
      return { ok: true, sessionVersion: this.bumpSession(), ...st };
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(800);
    this.stage = "wait_map";
    try {
      await this.waitForGameReady(page, budget);
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") throw err;
      // Soft fail fast for ChatGPT — caller should retry ensure_ready (often ready on 2nd call).
      if (await this.isHupReady(page)) {
        await this.inject(page).catch(() => undefined);
      }
      const st = await this.healthRaw();
      return {
        ok: false,
        error:
          (err instanceof Error ? err.message : String(err)) +
          " — retry ensure_ready in a few seconds",
        ...st,
      };
    }
    await this.inject(page);
    const st = await this.healthRaw();
    const ok = !!(st.hupReady && st.gameId === gameId);
    return {
      ok,
      sessionVersion: ok ? this.bumpSession() : this.sessionVersion(),
      error: ok
        ? undefined
        : `opened but gameId=${st.gameId} hupReady=${st.hupReady}`,
      ...st,
    };
  }

  async afterNavigation(): Promise<void> {
    const page = this.requirePage();
    await page.waitForTimeout(1500);
    await this.waitForGameReady(page, readyTimeoutMs());
    await this.inject(page);
  }

  async health(): Promise<SessionStatus & { ok: boolean; error?: string }> {
    try {
      await this.ensureStarted();
      const st = await this.healthRaw();
      return { ok: st.hupReady && st.injectOk, ...st };
    } catch (err) {
      return {
        ok: false,
        connected: false,
        loggedIn: false,
        hupReady: false,
        injectOk: false,
        gameId: null,
        playerId: null,
        siteUserId: null,
        pageUrl: null,
        mode: this.mode,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Tools that only need Ultimate `hup` (lobby OK). Map/provinces not required —
   * e.g. list_games uses hupwebapi.getMyGames from home/overview.
   */
  private static readonly HUP_ONLY_METHODS = new Set([
    "list_games",
    "current_game",
    "use_game",
  ]);

  async call(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureStarted();
    const page = this.requirePage();

    if (!(await this.isHupReady(page))) {
      throw new ToolOpError(
        "need_ensure_ready",
        "game not ready",
        "Call ensure_ready({ gameId }) once, wait if map is still loading, then retry this tool.",
      );
    }
    // Finance / armies need map — short wait only. Lobby tools must NOT wait.
    const needsMap = !GameSession.HUP_ONLY_METHODS.has(method);
    if (needsMap && !(await this.isMapReady(page))) {
      try {
        await this.waitForGameReady(page, 8_000);
      } catch (err) {
        throw new ToolOpError(
          "map_not_ready",
          err instanceof Error ? err.message : String(err),
          "Call ensure_ready({ gameId }) alone, then retry this one tool.",
        );
      }
    }

    const hasRpc = await page.evaluate(
      () =>
        typeof (window as unknown as { s1914?: { rpc?: unknown } }).s1914?.rpc ===
        "function",
    );
    if (!hasRpc) {
      await this.inject(page);
    }

    return page.evaluate(
      async ({ m, a }) => {
        const s1914 = (
          window as unknown as {
            s1914?: {
              rpc: (x: string, y: unknown) => Promise<unknown>;
              rebind?: () => void;
            };
          }
        ).s1914;
        if (!s1914 || typeof s1914.rpc !== "function") {
          throw new Error("s1914.rpc missing — inject failed");
        }
        try {
          s1914.rebind?.();
        } catch {
          /* ignore */
        }
        return s1914.rpc(m, a);
      },
      { m: method, a: args },
    );
  }

  private withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label)), ms);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private async healthRaw(): Promise<SessionStatus> {
    const page = this.page && !this.page.isClosed() ? this.page : null;
    if (!page) {
      return {
        connected: false,
        loggedIn: false,
        hupReady: false,
        injectOk: false,
        gameId: null,
        playerId: null,
        siteUserId: null,
        pageUrl: null,
        mode: this.mode,
      };
    }
    const blank: SessionStatus = {
      connected: true,
      loggedIn: false,
      hupReady: false,
      injectOk: false,
      gameId: null,
      playerId: null,
      siteUserId: null,
      pageUrl: page.url(),
      mode: this.mode,
    };
    try {
      const info = await this.withTimeout(
        page.evaluate(HUP_PROBE) as Promise<{
          hupReady: boolean;
          gameId: number | null;
          playerId: number | null;
          siteUserId: number | null;
        }>,
        8_000,
        "page_probe_timeout",
      );
      const injectOk = await this.withTimeout(
        page.evaluate(
          () =>
            typeof (window as unknown as { s1914?: { rpc?: unknown } }).s1914?.rpc ===
            "function",
        ),
        8_000,
        "page_probe_timeout",
      );
      let loggedIn = info.hupReady;
      if (!loggedIn) {
        loggedIn = !(await this.withTimeout(needsLogin(page), 8_000, "page_probe_timeout").catch(
          () => true,
        ));
      }
      return {
        connected: true,
        loggedIn,
        hupReady: info.hupReady,
        injectOk,
        gameId: info.gameId,
        playerId: info.playerId,
        siteUserId: info.siteUserId,
        pageUrl: page.url(),
        mode: this.mode,
      };
    } catch {
      return blank;
    }
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) {
      throw new Error("no game page — start session / log in first");
    }
    return this.page;
  }

  private async isHupReady(page: Page): Promise<boolean> {
    try {
      const info = (await page.evaluate(HUP_PROBE)) as { hupReady: boolean };
      return !!info.hupReady;
    } catch {
      return false;
    }
  }

  private async isMapReady(page: Page): Promise<boolean> {
    try {
      const info = (await page.evaluate(HUP_PROBE)) as { mapReady?: boolean };
      return !!info.mapReady;
    } catch {
      return false;
    }
  }

  private async findOrOpenGamePage(): Promise<Page> {
    const ctx = this.context;
    if (!ctx) throw new Error("browser context not started");

    for (const page of ctx.pages()) {
      const url = page.url();
      if (/supremacy|bytro|s1914|1914|game\.php/i.test(url)) {
        return page;
      }
    }

    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (!/supremacy1914\.(com|de)/i.test(page.url())) {
      await page.goto(this.startUrl, { waitUntil: "domcontentloaded" });
    }
    return page;
  }

  private async waitForHup(page: Page, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isHupReady(page)) return;
      await page.waitForTimeout(1500);
    }
    throw new Error(
      "hup not ready — open a joined game map (or ensure_ready with gameId)",
    );
  }

  /** hup.gameState + map.getPlayerProvinces available. */
  private async waitForGameReady(page: Page, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const gen = this.generation;
    while (Date.now() - start < timeoutMs) {
      if (gen !== this.generation) throw new Error("cancelled");
      if ((await this.isHupReady(page)) && (await this.isMapReady(page))) return;
      await page.waitForTimeout(1500);
    }
    if (gen !== this.generation) throw new Error("cancelled");
    if (await this.isHupReady(page)) {
      throw new Error(
        "mapState not ready — Ultimate client still loading provinces; retry ensure_ready",
      );
    }
    throw new Error(
      "hup not ready — open a joined game map (or ensure_ready with gameId)",
    );
  }

  private async inject(page: Page): Promise<void> {
    // Always re-read so docker/hotpatch updates to browser-helpers.js apply.
    this.injectSource = await readFile(INJECT_PATH, "utf8");
    await page.evaluate((src) => {
      // eslint-disable-next-line no-eval
      eval(src);
    }, this.injectSource);
    const ok = await page.evaluate(
      () =>
        typeof (window as unknown as { s1914?: { rpc?: unknown } }).s1914?.rpc ===
        "function",
    );
    if (!ok) throw new Error("inject succeeded but s1914.rpc missing");
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    const ms = Number(process.env.S1914_KEEP_MS || 15000);
    this.keepTimer = setInterval(() => {
      void this.keepTick();
    }, Number.isFinite(ms) && ms >= 5000 ? ms : 15000);
  }

  private stopKeepAlive(): void {
    if (this.keepTimer) clearInterval(this.keepTimer);
    this.keepTimer = null;
  }

  /** Replant inject if the tab reloaded / lost s1914.rpc. Skip while a tool owns the page. */
  private async keepTick(): Promise<void> {
    try {
      if (this.isBusy()) return;
      if (!this.page || this.page.isClosed()) return;
      if (!(await this.isHupReady(this.page))) return;
      const hasRpc = await this.page.evaluate(
        () =>
          typeof (window as unknown as { s1914?: { rpc?: unknown } }).s1914
            ?.rpc === "function",
      );
      if (!hasRpc) {
        await this.inject(this.page);
        process.stderr.write("[mcp-supremacy] keep: reinjected helpers\n");
      }
    } catch {
      /* ignore keep errors */
    }
  }
}
