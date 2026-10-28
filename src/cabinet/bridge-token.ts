import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function bridgeTokenPath(dataDir: string): string {
  return path.join(dataDir, "bridge.token");
}

export function persistBridgeToken(token: string, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(bridgeTokenPath(dataDir), `${token.trim()}\n`, "utf8");
}

export function readPersistedBridgeToken(dataDir: string): string | null {
  try {
    const t = readFileSync(bridgeTokenPath(dataDir), "utf8").trim();
    return t.length >= 8 ? t : null;
  } catch {
    return null;
  }
}

/** Use env token, else the persisted file, else generate one for this process. */
export function resolveBridgeToken(
  fromEnv: string,
  dataDir = "data/cabinet",
): string {
  const trimmed = fromEnv.trim();
  if (trimmed.length >= 8) {
    persistBridgeToken(trimmed, dataDir);
    return trimmed;
  }
  const fromFile = readPersistedBridgeToken(dataDir);
  if (fromFile) return fromFile;
  const generated = randomBytes(16).toString("hex");
  persistBridgeToken(generated, dataDir);
  return generated;
}
