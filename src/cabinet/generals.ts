import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WarPictureRaw } from "./war-types.js";
import { getEventBus } from "./events.js";

export type GeneralStatus =
  | "IDLE"
  | "MOVING"
  | "ENGAGING"
  | "DEFENDING"
  | "ATTACKING"
  | "RETREATING"
  | "REGROUPING"
  | "REINFORCING"
  | "WAITING"
  | "REPAIRING"
  | "MISSION_COMPLETE";

export interface GeneralRecord {
  id: string;
  /** In-game hero name from the picture. */
  name: string;
  /** President-assigned call-sign used in cabinet chat. */
  callSign?: string;
  heroArmyId?: number;
  role: string;
  groupId?: string;
  /** Armies ordered to stick with this hero. */
  assignedArmyIds: number[];
  mission?: string;
  objective?: string;
  posture?: "DEFENSIVE" | "OFFENSIVE" | "HOLD";
  rules?: string[];
  status: GeneralStatus;
  queuedOrderIds: string[];
  completedOrderIds: string[];
  updatedAt: string;
}

/** Name ministers should use in speech. */
export function generalCallName(g: GeneralRecord): string {
  return g.callSign?.trim() || g.name;
}

export async function loadGenerals(rootDir: string): Promise<GeneralRecord[]> {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, "generals.json"), "utf8"),
    ) as GeneralRecord[];
  } catch {
    return [];
  }
}

export async function saveGenerals(
  rootDir: string,
  generals: GeneralRecord[],
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    path.join(rootDir, "generals.json"),
    JSON.stringify(generals, null, 2),
    "utf8",
  );
}

/** Seed generals from deployed heroes on the map. */
export async function seedGeneralsFromPicture(
  rootDir: string,
  picture: WarPictureRaw | null | undefined,
): Promise<GeneralRecord[]> {
  const existing = await loadGenerals(rootDir);
  const byArmy = new Map(
    existing.filter((g) => g.heroArmyId != null).map((g) => [g.heroArmyId!, g]),
  );
  const now = new Date().toISOString();
  const heroesBlob = picture?.heroes as
    | {
        deployedOnMap?: Array<{
          armyId: number;
          province?: string | null;
          heroes?: Array<{ name?: string; shortName?: string }>;
        }>;
      }
    | undefined;
  const deployed = heroesBlob?.deployedOnMap ?? [];

  for (const d of deployed) {
    const name = d.heroes?.[0]?.name || d.heroes?.[0]?.shortName || `Hero ${d.armyId}`;
    const prev = byArmy.get(d.armyId);
    let role = "Theater commander";
    let groupId: string | undefined = prev?.groupId;
    let posture: GeneralRecord["posture"] = prev?.posture ?? "HOLD";
    if (/marco|martello|fiero/i.test(name) || /prince george|iskut|whitehorse/i.test(d.province ?? "")) {
      role = "Alaska Ground Commander";
      groupId = "grp_alaska_screen";
      posture = "DEFENSIVE";
    } else if (/maeve|porter|fiona/i.test(name) || /papeete|honolulu/i.test(d.province ?? "")) {
      role = "Air-bridge / Island Commander";
      groupId = "grp_air_bridge";
      posture = "OFFENSIVE";
    } else if (/lawrence|arabia/i.test(name)) {
      role = "Canada screen";
      groupId = "grp_reserve";
    }

    byArmy.set(d.armyId, {
      id: prev?.id ?? `gen_${d.armyId}`,
      name,
      callSign: prev?.callSign,
      heroArmyId: d.armyId,
      role,
      groupId,
      assignedArmyIds: [
        ...new Set([d.armyId, ...(prev?.assignedArmyIds ?? [])]),
      ],
      mission: prev?.mission,
      objective: prev?.objective,
      posture,
      rules: prev?.rules ?? [
        "never split attached core without approval",
        "keep assigned stacks with this hero",
        "follow general movement plan",
      ],
      status: prev?.status ?? "IDLE",
      queuedOrderIds: prev?.queuedOrderIds ?? [],
      completedOrderIds: prev?.completedOrderIds ?? [],
      updatedAt: now,
    });
  }

  const out = [...byArmy.values()];
  // Keep orphans from file
  for (const g of existing) {
    if (g.heroArmyId != null && byArmy.has(g.heroArmyId)) continue;
    if (!out.find((x) => x.id === g.id)) out.push(g);
  }
  await saveGenerals(rootDir, out);
  return out;
}

export async function assignArmyToGeneral(
  rootDir: string,
  generalId: string,
  armyId: number,
): Promise<GeneralRecord | null> {
  const generals = await loadGenerals(rootDir);
  const g = generals.find((x) => x.id === generalId || String(x.heroArmyId) === generalId);
  if (!g) return null;
  if (!g.assignedArmyIds.includes(armyId)) g.assignedArmyIds.push(armyId);
  g.updatedAt = new Date().toISOString();
  await saveGenerals(rootDir, generals);
  await getEventBus(rootDir).publish("HERO_ASSIGNED", {
    source: "generals",
    payload: { generalId: g.id, armyId },
  });
  return g;
}

export async function setGeneralMission(
  rootDir: string,
  generalId: string,
  mission: string,
  status?: GeneralStatus,
): Promise<GeneralRecord | null> {
  const generals = await loadGenerals(rootDir);
  const g = generals.find(
    (x) => x.id === generalId || String(x.heroArmyId) === generalId,
  );
  if (!g) return null;
  g.mission = mission;
  if (status) g.status = status;
  g.updatedAt = new Date().toISOString();
  await saveGenerals(rootDir, generals);
  return g;
}

export async function renameGeneral(
  rootDir: string,
  generalId: string,
  callSign: string,
): Promise<GeneralRecord | null> {
  const generals = await loadGenerals(rootDir);
  const g = generals.find(
    (x) =>
      x.id === generalId ||
      String(x.heroArmyId) === generalId ||
      generalCallName(x).toLowerCase() === generalId.toLowerCase(),
  );
  if (!g) return null;
  g.callSign = callSign.trim().slice(0, 48);
  g.updatedAt = new Date().toISOString();
  await saveGenerals(rootDir, generals);
  return g;
}

export function formatGeneralsBrief(generals: GeneralRecord[]): string {
  if (!generals.length) return "(no generals seeded)";
  return generals
    .slice(0, 8)
    .map((g) => {
      const call = generalCallName(g);
      const game =
        g.callSign && g.callSign !== g.name ? ` (game: ${g.name})` : "";
      const stack = g.assignedArmyIds.slice(0, 8).join(",") || "none";
      return `Call "${call}"${game} [${g.status}] ${g.role} — keep armies ${stack} with him${g.mission ? ` — ${g.mission}` : ""}`;
    })
    .join("\n");
}
