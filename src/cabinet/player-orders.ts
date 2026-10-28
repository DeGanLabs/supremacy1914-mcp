import type { PlayerGoal } from "./types.js";

/** Detect when a player message wants to override standing hold/no-invade/focus. */
export function detectGoalOverrideIntent(text: string): {
  wantsOverride: boolean;
  proposed: Array<{ key: string; value: string }>;
  summary: string;
} | null {
  const t = text.trim();
  if (t.length < 8) return null;
  // Newspaper / diplo drafting / advisory chat is not a war-order override.
  if (
    /\b(article|newspaper|write news|press release|propaganda|text\s+\w|msg\s+\w|dm\b|draft\s+(a\s+|the\s+)?message)\b/i.test(
      t,
    )
  ) {
    return null;
  }
  // "one short take", "make sense?", "still with us?" — advice, not new orders.
  if (
    /\?\s*$/.test(t) ||
    /\b(make sense|what do you think|one (short )?take|still with us|short answer)\b/i.test(
      t,
    )
  ) {
    return null;
  }
  const pushLike =
    /\b(push|invade|attack|strike|advance|air-?bridge|screen alaska|distrust|go for|move on)\b/i.test(
      t,
    ) || /\btake\s+(the\s+)?[A-Za-z]{3,}/i.test(t);
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
  // Africa recovery vs Central USA — Morocco / East Libya, stop at Africa
  if (
    /usa|central usa|america/i.test(t) &&
    /morocco|libya|africa|maroco|afrika/i.test(t)
  ) {
    proposed.push({
      key: "focus:africa-vs-usa",
      value: "Retake Morocco + East Libya from Central USA; hold Africa rim",
    });
    if (/morocco|maroco/i.test(t)) {
      proposed.push({ key: "focus:morocco", value: "retake Morocco from Central USA" });
    }
    if (/east libya|libya/i.test(t)) {
      proposed.push({
        key: "focus:east-libya",
        value: "retake East Libya from Central USA",
      });
    }
    if (/no further|dont push|don't push|rest in africa|stop at africa|not deeper|homeland/i.test(t)) {
      proposed.push({
        key: "no-invade:usa-beyond-africa",
        value: "Do not push Central USA beyond African theater",
      });
    }
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
