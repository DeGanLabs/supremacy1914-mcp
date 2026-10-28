/** Cabinet UI / advisor speech languages. */
export type CabinetLanguage = "en" | "fr" | "tn";

export const CABINET_LANGUAGES: ReadonlyArray<{
  readonly id: CabinetLanguage;
  readonly label: string;
  readonly promptName: string;
}> = [
  { id: "en", label: "English", promptName: "English" },
  { id: "fr", label: "Français", promptName: "French" },
  {
    id: "tn",
    label: "Tounsi",
    promptName:
      "Tunisian Darija (Latin script — natural spoken Tunisian, not formal MSA)",
  },
];

export function isCabinetLanguage(v: string): v is CabinetLanguage {
  return v === "en" || v === "fr" || v === "tn";
}

export function languageLabel(id: CabinetLanguage | string | null | undefined): string {
  const hit = CABINET_LANGUAGES.find((l) => l.id === id);
  return hit?.label ?? "English";
}

export function languagePromptName(
  id: CabinetLanguage | string | null | undefined,
): string {
  const hit = CABINET_LANGUAGES.find((l) => l.id === id);
  return hit?.promptName ?? "English";
}

/**
 * Detect a one-shot output language for drafts/articles/speech.
 * Does not change the cabinet default.
 */
export function detectOutputLanguageOverride(text: string): string | null {
  const t = text.toLowerCase();
  const patterns: Array<{ re: RegExp; lang: string }> = [
    {
      re: /\b(?:in|en)\s+(?:tunisian|tounsi|darija|tunisien)\b/i,
      lang: "Tunisian Darija (Latin script)",
    },
    { re: /\b(?:in|en)\s+french\b|\ben français\b/i, lang: "French" },
    { re: /\b(?:in|en)\s+english\b|\ben anglais\b/i, lang: "English" },
    { re: /\b(?:in|en)\s+arabic\b|\ben arabe\b/i, lang: "Arabic" },
    { re: /\b(?:in|en)\s+russian\b|\ben russe\b/i, lang: "Russian" },
    { re: /\b(?:in|en)\s+german\b|\ben allemand\b/i, lang: "German" },
    { re: /\b(?:in|en)\s+spanish\b|\ben espagnol\b/i, lang: "Spanish" },
    { re: /\b(?:in|en)\s+turkish\b|\ben turc\b/i, lang: "Turkish" },
    { re: /\b(?:in|en)\s+polish\b|\ben polonais\b/i, lang: "Polish" },
    {
      re: /\bdraft\s+(?:a\s+)?(?:message|article|news)\s+in\s+([a-zàâäéèêëïîôùûüç]+)/i,
      lang: "$1",
    },
    {
      re: /\b(?:article|message|news)\s+in\s+([a-zàâäéèêëïîôùûüç]+)/i,
      lang: "$1",
    },
  ];
  for (const { re, lang } of patterns) {
    const m = t.match(re);
    if (!m) continue;
    if (lang.startsWith("$") && m[1]) {
      const word = m[1].trim();
      const map: Record<string, string> = {
        french: "French",
        français: "French",
        francais: "French",
        english: "English",
        anglais: "English",
        arabic: "Arabic",
        arabe: "Arabic",
        russian: "Russian",
        russe: "Russian",
        german: "German",
        allemand: "German",
        spanish: "Spanish",
        espagnol: "Spanish",
        turkish: "Turkish",
        turc: "Turkish",
        polish: "Polish",
        polonais: "Polish",
        tunisian: "Tunisian Darija (Latin script)",
        tounsi: "Tunisian Darija (Latin script)",
        darija: "Tunisian Darija (Latin script)",
        tunisien: "Tunisian Darija (Latin script)",
      };
      return map[word] ?? word.charAt(0).toUpperCase() + word.slice(1);
    }
    return lang;
  }
  return null;
}

/** Prompt block injected into every seat system prompt. */
export function buildLanguagePromptBlock(input: {
  readonly cabinetLanguage: CabinetLanguage;
  readonly outputOverride?: string | null;
  readonly forDraftOrArticle?: boolean;
}): string {
  const cabinet = languagePromptName(input.cabinetLanguage);
  const lines = [
    `Language: Speak to the president in ${cabinet}. Keep game proper nouns (province/nation names) as in tools.`,
  ];
  if (input.outputOverride?.trim()) {
    lines.push(
      input.forDraftOrArticle
        ? `This turn: write draft_message and/or newspaper body in ${input.outputOverride.trim()}. public_line to the president stays in ${cabinet}.`
        : `This turn: answer the president in ${input.outputOverride.trim()} (override).`,
    );
  }
  return lines.join("\n");
}

/** True when text asks to send the last diplo draft. */
export function wantsSendLastDraft(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(send that|send it|yes send|send now|send directly|envoie[-\s]?le|envoye[-\s]?le|ba3ath|baath)\.?$/i.test(
      t,
    ) ||
    /\b(send that|send it|send the draft|send (the )?message now|send directly)\b/i.test(
      t,
    )
  );
}
