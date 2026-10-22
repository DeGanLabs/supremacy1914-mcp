/**
 * Newspaper / Daily European is PUBLIC. Never publish live ops.
 */

const LEAK_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\b\d+\s*[-–—]?\s*\d*\s*h(ours?)?\b/i, label: "attack timing" },
  { re: /\b(in|within)\s+\d+\s*h\b/i, label: "attack timing" },
  { re: /\bcross(es|ing)?\s+(in|on our|hits?)\b/i, label: "cross timetable" },
  { re: /\bnorthern cross\b/i, label: "ops codename" },
  { re: /\barmy\s*#?\s*\d{5,}\b/i, label: "army id" },
  { re: /\b17\d{6}\b/, label: "army id" },
  { re: /\b(callahan)\b/i, label: "hero call-sign" },
  { re: /\b\d+\s*(infantry|inf\.?|artillery|tanks?)\b/i, label: "stack size" },
  {
    re: /\b(columns?\s+onto|main effort|fixing force|timetable)\b/i,
    label: "ops jargon",
  },
  { re: /\b(draft queued|tap home|send the draft)\b/i, label: "staff process" },
  { re: /\b(share-?map|row only|right of way)\b/i, label: "diplo internals" },
];

export function newsOpsecViolations(text: string): string[] {
  const t = String(text ?? "");
  const hits: string[] = [];
  for (const { re, label } of LEAK_PATTERNS) {
    if (re.test(t) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

export function newsLeaksOps(title: string, body: string): boolean {
  return newsOpsecViolations(`${title}\n${body}`).length > 0;
}

/** Soften leaked copy into vague propaganda (last resort before publish). */
export function sanitizeNewsCopy(input: {
  title: string;
  body: string;
}): { title: string; body: string; scrubbed: boolean; reasons: string[] } {
  const reasons = newsOpsecViolations(`${input.title}\n${input.body}`);
  if (!reasons.length) {
    return { title: input.title, body: input.body, scrubbed: false, reasons: [] };
  }
  let body = input.body
    .replace(/\b\d+\s*[-–—]?\s*\d*\s*h(ours?)?\b/gi, "when the hour comes")
    .replace(/\b(in|within)\s+\d+\s*h\b/gi, "when the hour comes")
    .replace(/\bnorthern cross\b/gi, "our eastern commitment")
    .replace(/\bcross(es|ing)?\s+(in|on our|hits?)\b/gi, "stands ready")
    .replace(/\barmy\s*#?\s*\d{5,}\b/gi, "our forces")
    .replace(/\b17\d{6}\b/g, "our forces")
    .replace(/\b\d+\s*(infantry|inf\.?|artillery|tanks?)\b/gi, "our forces")
    .replace(/\b(callahan)\b/gi, "our command")
    .replace(/\b(draft queued|tap home|send the draft)\b/gi, "")
    .replace(/\b(columns?\s+onto|main effort|timetable)\b/gi, "operations")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (newsOpsecViolations(`${input.title}\n${body}`).length) {
    body =
      "Ukraine stands with its partners. Those who threaten our friends threaten the peace of Europe. We watch, we endure, and we answer in kind.";
  }
  return {
    title: input.title.slice(0, 120) || "Eastern Front Bulletin",
    body: body.slice(0, 2000),
    scrubbed: true,
    reasons,
  };
}

/**
 * Guess diplo target from player ask + foreign public_line + draft greeting.
 */
export function guessDiploTarget(input: {
  question: string;
  publicLine?: string | null;
  draft?: string | null;
}): string | null {
  const q = input.question ?? "";
  const patterns = [
    /\b(?:text|msg|message(?:\s+to)?|dm|tell|write(?:\s+(?:a|the)?\s*message)?(?:\s+to)?|draft(?:\s+(?:a|the)?\s*message)?(?:\s+to)?|write\s+for|message\s+for)\s+([A-Za-z][A-Za-z\- ]{1,40})/i,
    /\bdraft\s+ready\s+for\s+([A-Za-z][A-Za-z\- ]{1,40})/i,
    /\bsent\s+to\s+([A-Za-z][A-Za-z\- ]{1,40})/i,
    /\bfor\s+(finland|poland|ottoman|romania|rumania|caucasus|germany|russia|lithuania)\b/i,
    /\b(finland|poland|ottoman|romania|rumania|caucasus|germany)\b/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (m?.[1]) return cleanNation(m[1]);
  }
  const pl = input.publicLine ?? "";
  const plHit = pl.match(
    /\b(?:draft\s+ready\s+for|sent\s+to|message\s+for)\s+([A-Za-z][A-Za-z\- ]{1,40})/i,
  );
  if (plHit?.[1]) return cleanNation(plHit[1]);

  const draft = (input.draft ?? "").trim();
  const greet = draft.match(
    /^([A-Za-z][A-Za-z0-9\- ]{1,40})\s*[—–,:-]/,
  );
  if (greet?.[1] && greet[1].length <= 32) {
    return greet[1].trim();
  }
  return null;
}

function cleanNation(raw: string): string {
  return raw
    .replace(/\b(a|the|message|article|news|draft)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}
