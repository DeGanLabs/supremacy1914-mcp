import type { PlayerGoal } from "./types.js";

/** Detect when a player message wants to override standing hold/no-invade/focus. */
export function detectGoalOverrideIntent(text: string): {
  wantsOverride: boolean;
  proposed: Array<{ key: string; value: string }>;
  summary: string;
} | null {
  const t = text.trim();
  if (t.length < 8) return null;
  const pushLike =
    /\b(push|invade|attack|take|strike|advance|air-?bridge|screen alaska|distrust|dm |draft|go for|move on)\b/i.test(
      t,
    );
  const conflictsStanding =
    /\b(no-?invade|hold|don'?t attack|stand down)\b/i.test(t) === false &&
    pushLike;
  if (!conflictsStanding && !/\b(new orders?|override|change orders?|focus:|distrust:)\b/i.test(t)) {
    return null;
  }

  const proposed: Array<{ key: string; value: string }> = [];
  if (/air-?bridge/i.test(t)) {
    proposed.push({ key: "focus:air-bridge", value: t.slice(0, 160) });
  }
  if (/alaska/i.test(t) && /screen|hold|push|invade/i.test(t)) {
    proposed.push({ key: "focus:alaska", value: t.slice(0, 160) });
  }
  const distrust = t.match(/distrust[:\s]+([A-Za-z][A-Za-z\s]{1,40})/i);
  if (distrust?.[1]) {
    const nation = distrust[1].trim();
    proposed.push({ key: `distrust:${nation}`, value: nation });
  }
  if (/invade|attack|push|take|strike/i.test(t) && /alaska|yakut|adak|atka|canada|whitehorse/i.test(t)) {
    proposed.push({
      key: "war:player-push",
      value: t.slice(0, 200),
    });
    // Soft-clear no-invade for alaska theater if player is pushing
    proposed.push({
      key: "clear:no-invade:alaska",
      value: "player override pending confirm",
    });
  }
  if (!proposed.length) {
    proposed.push({ key: "war:player-order", value: t.slice(0, 200) });
  }
  return {
    wantsOverride: true,
    proposed,
    summary: t.slice(0, 220),
  };
}

export function applyConfirmedGoals(
  current: PlayerGoal[],
  proposed: ReadonlyArray<{ key: string; value: string }>,
): PlayerGoal[] {
  const now = new Date().toISOString();
  let next = [...current];
  for (const p of proposed) {
    if (p.key.startsWith("clear:no-invade:")) {
      const tag = p.key.slice("clear:no-invade:".length).toLowerCase();
      next = next.filter(
        (g) =>
          !(
            g.key.startsWith("no-invade:") &&
            (g.key.toLowerCase().includes(tag) ||
              g.value.toLowerCase().includes(tag))
          ),
      );
      continue;
    }
    next = next.filter((g) => g.key !== p.key);
    next.push({ key: p.key, value: p.value, setAt: now });
  }
  return next;
}

export function formatProposedGoals(
  proposed: ReadonlyArray<{ key: string; value: string }>,
): string {
  return proposed.map((p) => `• ${p.key}: ${p.value}`).join("\n");
}
