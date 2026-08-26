/** Telegram-facing icons for seats and military text. */

export const SEAT_ICONS: Record<string, string> = {
  war: "⚔️",
  defense: "🛡️",
  finance: "💰",
  intel: "🕵️",
  foreign: "🤝",
};

export function seatIcon(seatId: string): string {
  return SEAT_ICONS[seatId] ?? "👤";
}

export function seatLabel(seatId: string, name: string): string {
  return `${seatIcon(seatId)} ${name}`;
}

const UNIT_PATTERNS: ReadonlyArray<{ re: RegExp; emoji: string }> = [
  { re: /\b(artillery|arty|howitzer|gun\s*battery)\b/gi, emoji: "🎯" },
  { re: /\b(infantry|infantrymen|inf\.?)\b/gi, emoji: "🪖" },
  { re: /\b(tank|tanks|armor|armour)\b/gi, emoji: "🚗" },
  {
    re: /\b(battleship|cruiser|destroyer|submarine|fleet|naval|ship|ships|transport|embarked)\b/gi,
    emoji: "🚢",
  },
  {
    re: /\b(balloon|plane|planes|aircraft|air\s*force|fighter|bomber)\b/gi,
    emoji: "✈️",
  },
  { re: /\b(cavalry|railgun|rail\s*gun)\b/gi, emoji: "🐎" },
  { re: /\b(fortress|fort|bunker)\b/gi, emoji: "🏰" },
  { re: /\b(factory|factories|workshop)\b/gi, emoji: "🏭" },
  { re: /\b(spy|spies|recon)\b/gi, emoji: "🕵️" },
  { re: /\b(grain|food)\b/gi, emoji: "🌾" },
  { re: /\b(oil|fuel)\b/gi, emoji: "🛢️" },
  { re: /\b(metal|iron|steel)\b/gi, emoji: "⚙️" },
  { re: /\b(money|geld|cash|budget)\b/gi, emoji: "💵" },
];

/** Decorate free text with unit / resource emojis (skip if emoji already adjacent). */
export function decorateMilitaryText(text: string): string {
  let out = String(text ?? "");
  for (const { re, emoji } of UNIT_PATTERNS) {
    // Regex may have capture groups — offset/string are always the last two args.
    out = out.replace(re, (...args: unknown[]) => {
      const match = String(args[0] ?? "");
      const full = String(args[args.length - 1] ?? "");
      const offset = Number(args[args.length - 2] ?? 0);
      if (!Number.isFinite(offset) || typeof full !== "string") {
        return match.includes(emoji) ? match : `${emoji} ${match}`;
      }
      const before = full.slice(Math.max(0, offset - 3), offset);
      if (before.includes(emoji) || match.includes(emoji)) return match;
      return `${emoji} ${match}`;
    });
  }
  out = out
    .replace(/\bin range\b/gi, "⚠️ in range")
    .replace(/\bcontact\b/gi, "⚡ contact")
    .replace(/\bbombard\b/gi, "💥 bombard")
    .replace(/\bidle\b/gi, "😴 idle");
  out = out.replace(/(🕵️\s*){2,}/g, "🕵️ ");
  return out;
}

/** Split long minister speech into short Telegram paragraphs. */
export function splitParagraphs(text: string, maxBlocks = 5): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const chunks = cleaned
    .split(/(?<=[.!?])\s+|\s*;\s+|\s+[—–]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length <= 1) return cleaned;
  return chunks.slice(0, maxBlocks).join("\n\n");
}

export function formatMinisterLine(
  seatId: string,
  seatName: string,
  publicLine: string,
): string {
  const body = decorateMilitaryText(splitParagraphs(publicLine.trim()));
  return `${seatIcon(seatId)} *${seatName}*\n${body}`;
}

export function formatStatusLines(input: {
  bridgeUp: boolean;
  gameId: number | string | null;
  playerId: number | string | null;
  heartbeat: string | null;
  model: string;
  fast: string;
  openPlans: number;
  advisor: string | null;
  busySeats: readonly string[];
  autoPilot?: boolean;
}): string {
  const bridge = input.bridgeUp ? "🟢 UP" : "🔴 DOWN";
  const advisor = input.advisor
    ? `${seatIcon(input.advisor)} ${input.advisor}`
    : "none — /advisor";
  const busy = input.busySeats.length
    ? input.busySeats.map((s) => `${seatIcon(s)} ${s}`).join(", ")
    : "none";
  return [
    `📡 *Cabinet status*`,
    `Bridge: ${bridge}`,
    `Game: \`${input.gameId ?? "—"}\` · Player: \`${input.playerId ?? "—"}\``,
    `Heartbeat: ${input.heartbeat ?? "—"}`,
    `Model: ${input.model}`,
    `Fast: ${input.fast}`,
    `Open plans: ${input.openPlans}`,
    `Auto: ${input.autoPilot ? "🟢 ON" : "⚪ OFF"}`,
    `Talking to: ${advisor}`,
    `Thinking: ${busy}`,
  ].join("\n");
}
