/** Redact secrets from logs / error strings / Telegram. */
export function redactSecrets(text: string): string {
  return String(text)
    .replace(/nvapi-[A-Za-z0-9_-]+/g, "nvapi-[REDACTED]")
    .replace(/\d{8,}:[A-Za-z0-9_-]{30,}/g, "[TELEGRAM_TOKEN_REDACTED]")
    .replace(
      /(NVIDIA_API_KEY|TELEGRAM_BOT_TOKEN|S1914_USER_AUTH|S1914_COOKIE|S1914_TSTAMP|CABINET_BRIDGE_TOKEN|userAuth|tstamp)[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/bl_sid=[^;\s]+/gi, "bl_sid=[REDACTED]")
    .replace(/Cookie:\s*[^\n]+/gi, "Cookie: [REDACTED]")
    .replace(/\b[a-fA-F0-9]{40}\b/g, "[AUTH_HEX_REDACTED]");
}
