import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SeatOverride {
  readonly id: string;
  displayName?: string;
  personality?: string;
  updatedAt?: string;
}

export type SeatOverridesFile = {
  readonly seats: SeatOverride[];
  readonly updatedAt: string;
};

function overridesPath(dataDir: string): string {
  return path.join(dataDir, "seat-overrides.json");
}

export async function loadSeatOverrides(
  dataDir: string,
): Promise<Map<string, SeatOverride>> {
  const map = new Map<string, SeatOverride>();
  try {
    const raw = JSON.parse(
      await readFile(overridesPath(dataDir), "utf8"),
    ) as SeatOverridesFile;
    for (const s of raw.seats ?? []) {
      if (s?.id) map.set(s.id, s);
    }
  } catch {
    /* none yet */
  }
  return map;
}

export async function saveSeatOverrides(
  dataDir: string,
  map: Map<string, SeatOverride>,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const seats = [...map.values()];
  const file: SeatOverridesFile = {
    seats,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(overridesPath(dataDir), JSON.stringify(file, null, 2), "utf8");
}

export async function upsertSeatOverride(
  dataDir: string,
  patch: SeatOverride,
): Promise<SeatOverride> {
  const map = await loadSeatOverrides(dataDir);
  const prev = map.get(patch.id) ?? { id: patch.id };
  const next: SeatOverride = {
    ...prev,
    ...patch,
    id: patch.id,
    updatedAt: new Date().toISOString(),
  };
  map.set(patch.id, next);
  await saveSeatOverrides(dataDir, map);
  return next;
}

export function displayNameForSeat(
  seatId: string,
  defaultName: string,
  overrides: Map<string, SeatOverride> | null | undefined,
): string {
  const o = overrides?.get(seatId);
  return o?.displayName?.trim() || defaultName;
}
