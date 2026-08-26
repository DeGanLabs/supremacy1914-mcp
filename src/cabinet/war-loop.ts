import type { BrowserBridgeServer } from "../sensor/bridge-client.js";
import type { ScopeToolGateway } from "../sensor/gateway.js";
import type { CabinetMemory } from "./memory.js";
import type { CabinetChief } from "./chief.js";
import { DEFAULT_SEAT_SCOPES } from "./cost-caps.js";
import {
  alertsFromSnapshot,
  filterByStandingOrders,
  formatWarBoard,
  scoreWarPicture,
} from "./war-watch.js";
import type { WarPictureRaw, WarWatchSnapshot } from "./war-types.js";
import { formatWarBriefing } from "./war-brief.js";
import { buildWatchTelegramMessages } from "./war-digest.js";

export interface WarWatchLoopOptions {
  readonly bridge: BrowserBridgeServer;
  readonly gateway: ScopeToolGateway;
  readonly memory: CabinetMemory;
  readonly chief?: CabinetChief;
  readonly intervalMs: number;
  readonly enabled: boolean;
  /** Optional auto reinforce-only (P3): move idle own armies toward own border province. Off by default. */
  readonly autoReinforce?: boolean;
  readonly onAlert: (msg: {
    digest?: string;
    critical?: readonly string[];
    level: string;
    line: string;
    escalateAll: boolean;
    board?: string;
  }) => void | Promise<void>;
  readonly onHandoff?: (msg: {
    seat: "foreign" | "finance" | "intel";
    line: string;
  }) => void | Promise<void>;
}

export function startWarWatch(opts: WarWatchLoopOptions): { stop: () => void } {
  if (!opts.enabled) {
    return { stop: () => undefined };
  }

  let stopped = false;
  let ticking = false;

  const tick = async () => {
    if (stopped || ticking) return;
    if (!opts.bridge.isHealthy()) return;
    if (opts.chief?.isBusyForWarWatch()) return;
    ticking = true;
    try {
      const previous = await opts.memory.loadWarPicture<WarWatchSnapshot>();
      opts.gateway.resetTurn("war-watch");
      const raw = (await opts.gateway.call(
        "war-watch",
        DEFAULT_SEAT_SCOPES["war-watch"],
        "get_war_picture",
        {},
      )) as WarPictureRaw;

      // Persist median spacing calibration across ticks
      if (
        previous?.medianSpacing &&
        raw.gameId === previous.gameId &&
        !raw.medianSpacing
      ) {
        (raw as { medianSpacing?: number }).medianSpacing =
          previous.medianSpacing;
      }

      let snap = scoreWarPicture(raw, previous);
      const goals = await opts.memory.getGoals();
      snap = {
        ...snap,
        triggers: filterByStandingOrders(snap.triggers, goals),
      };

      await opts.memory.saveWarPicture(snap);
      for (const t of snap.triggers) {
        await opts.memory.appendWarEvent(t);
      }

      const dataDir =
        process.env.CABINET_DATA_DIR?.trim() || "data/cabinet";
      try {
        const { seedDefaultGroups, loadGroups, saveGroups } = await import(
          "./groups.js"
        );
        const { seedGeneralsFromPicture } = await import("./generals.js");
        const existing = await loadGroups(dataDir);
        await saveGroups(dataDir, seedDefaultGroups(snap.picture, existing));
        await seedGeneralsFromPicture(dataDir, snap.picture);
        const { ingestWarPictureSightings } = await import("./intel-events.js");
        await ingestWarPictureSightings(
          dataDir,
          snap.picture.foreignArmies ?? [],
        );
        const { getEventBus } = await import("./events.js");
        for (const w of snap.atWar.slice(0, 5)) {
          await getEventBus(dataDir).publish("WAR_DECLARED", {
            source: "war-watch",
            playerId: w.id,
            nation: w.nation || w.name,
          });
        }
        if (snap.picture.diplo?.embargo?.length) {
          const { recordEmbargo } = await import("./finance-model.js");
          for (const e of snap.picture.diplo.embargo.slice(0, 5)) {
            await recordEmbargo(dataDir, {
              playerId: e.id,
              nation: e.nation || e.name,
              note: "diplo embargo row",
            });
          }
        }
        const { getCommandQueue } = await import("./command-queue.js");
        const q = getCommandQueue(dataDir);
        await q.load();
        const conv = await opts.memory.loadConversationState();
        const mode = (conv?.humanMode as string) || (conv?.autoPilot ? "AUTO" : "CONFIRM");
        if (mode === "PAUSE" || mode === "ABORT") {
          q.setPaused(true);
          if (mode === "ABORT") q.setEmergencyStop(true);
        } else {
          q.setPaused(false);
          if (mode !== "ABORT") q.setEmergencyStop(false);
        }
        // Drain up to 2 ready commands when bridge healthy and not paused
        if (!q.isPaused() && opts.bridge.isHealthy()) {
          for (let i = 0; i < 2; i++) {
            const done = await q.executeNext(opts.bridge);
            if (!done) break;
          }
        }
      } catch (err) {
        console.warn(
          "[war-watch] bus/queue/groups:",
          err instanceof Error ? err.message : String(err),
        );
      }

      const alerts = alertsFromSnapshot(snap);
      const messages = buildWatchTelegramMessages(snap, goals, alerts);

      // Quieter sitreps while War seat is thinking / Auto hero advance running
      const warBusy = opts.chief?.busySeatIds()?.includes("war");
      if (warBusy && !messages.critical.length) {
        console.log("[war-watch] folding digest — War busy");
      } else if (messages.digest || messages.critical.length) {
        const intelGaps = [
          ...new Set(
            alerts
              .filter((a) => a.trigger.handoff === "intel")
              .map((a) => a.trigger.nation || a.trigger.province)
              .filter(Boolean),
          ),
        ].slice(0, 3);
        const digestParts = [
          messages.digest,
          messages.critical.length
            ? `Critical:\n${messages.critical.join("\n")}`
            : null,
          intelGaps.length
            ? `Intel note: spy gap on ${intelGaps.join(", ")} — ask @Intel if you want a plan.`
            : null,
        ].filter(Boolean);
        await opts.onAlert({
          level: messages.critical.length ? "high" : "medium",
          line: digestParts.join("\n\n"),
          digest: digestParts.join("\n\n"),
          critical: messages.critical,
          escalateAll: alerts.some((a) => a.escalateAll),
          board: alerts.some((a) => a.escalateAll)
            ? formatWarBoard(snap)
            : undefined,
        });
      }

      if (opts.autoReinforce) {
        await maybeAutoReinforce(opts, snap);
      }

      await maybeAdvanceHeroTasks(opts, snap);

      console.log(
        `[war-watch] ${snap.takenAt} wars=${snap.atWar.length} high=${snap.zones.filter((z) => z.level === "high").length} alerts=${alerts.length}`,
      );
    } catch (err) {
      console.warn(
        "[war-watch] tick failed:",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      ticking = false;
    }
  };

  // First tick soon, then interval
  const boot = setTimeout(() => {
    void tick();
  }, 8000);
  const timer = setInterval(() => {
    void tick();
  }, opts.intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearTimeout(boot);
      clearInterval(timer);
    },
  };
}

/** P3 optional: move idle army toward own border province capital — never into enemy. */
async function maybeAutoReinforce(
  opts: WarWatchLoopOptions,
  snap: WarWatchSnapshot,
): Promise<void> {
  const idleHot = snap.triggers.find((t) => t.kind === "IDLE_ON_HOT_FRONT");
  if (!idleHot?.armyId) return;
  const army = snap.picture.ownArmies?.find((a) => a.id === idleHot.armyId);
  if (!army?.idle) return;
  const border = snap.picture.borders?.find((b) =>
    idleHot.province
      ? b.province === idleHot.province ||
        b.facingProvince === idleHot.province
      : b.atWar,
  );
  // Need capital coords — borders don't store capital; use army pos nudge toward facing if we had it.
  // Safe rule: only log propose line unless we have explicit own province capital in picture.
  const ownProv = snap.picture.borders?.find((b) => b.province === army.province);
  if (!ownProv) {
    console.log(
      `[war-watch] auto-reinforce skipped — no own-province coords for army ${army.id}`,
    );
    return;
  }
  // Without capital coords on border rows, do not call moveArmy automatically.
  console.log(
    `[war-watch] auto-reinforce candidate army ${army.id} @ ${army.province} → hold ${border?.province ?? ownProv.province} (approve-gated; no auto move without capital)`,
  );
  await opts.onAlert({
    level: "medium",
    line: `AUTO-REINFORCE candidate: army ${army.id} idle @ ${army.province} — propose hold ${border?.province ?? army.province} /approve?`,
    escalateAll: false,
  });
}

/** Advance one queued hero task via @War when Auto is on (task-by-task). */
async function maybeAdvanceHeroTasks(
  opts: WarWatchLoopOptions,
  _snap: WarWatchSnapshot,
): Promise<void> {
  const conv = await opts.memory.loadConversationState();
  if (!conv?.autoPilot || !opts.chief) return;
  const { loadHeroTasks, updateHeroTask } = await import("./hero-tasks.js");
  const tasks = await loadHeroTasks(opts.memory);
  const next =
    tasks.find((t) => t.status === "active") ??
    tasks.find((t) => t.status === "queued");
  if (!next) return;
  if (next.status === "queued") {
    await updateHeroTask(opts.memory, next.id, { status: "active" });
  }
  const armies = [next.heroArmyId, ...next.attachedArmyIds].join(", ");
  const goalLine =
    next.goal === "invade"
      ? `Invade ${next.province ?? "target"} with armies ${armies} — plan moveArmy only for those ids`
      : next.goal === "withdraw"
        ? `Withdraw armies ${armies} safely to ${next.province ?? "friendly screen"} — no contact path`
        : `Hold with armies ${armies} at current screen — no offensive moves`;
  try {
    await opts.chief.handleUserMessage(`@War HERO TASK ${next.id}: ${goalLine}`, {
      forceSeatIds: ["war"],
      singleAdvisor: true,
    });
  } catch (err) {
    console.warn(
      "[hero-tasks]",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function fetchAndScoreOnce(
  gateway: ScopeToolGateway,
  memory: CabinetMemory,
): Promise<WarWatchSnapshot> {
  const previous = await memory.loadWarPicture<WarWatchSnapshot>();
  gateway.resetTurn("war-watch");
  const raw = (await gateway.call(
    "war-watch",
    DEFAULT_SEAT_SCOPES["war-watch"],
    "get_war_picture",
    {},
  )) as WarPictureRaw;
  const goals = await memory.getGoals();
  let snap = scoreWarPicture(raw, previous);
  snap = { ...snap, triggers: filterByStandingOrders(snap.triggers, goals) };
  await memory.saveWarPicture(snap);
  return snap;
}

export { formatWarBoard, formatWarBriefing };
