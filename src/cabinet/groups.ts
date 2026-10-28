import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WarPictureRaw } from "./war-types.js";
import { getEventBus } from "./events.js";

export type GroupRole = "alaska_screen" | "air_bridge" | "reserve" | "custom";

export interface ForceGroup {
  id: string;
  name: string;
  role: GroupRole;
  generalId?: string;
  armyIds: number[];
  province?: string;
  mission?: string;
  updatedAt: string;
}

function gid(role: string): string {
  return `grp_${role}`;
}

export async function loadGroups(rootDir: string): Promise<ForceGroup[]> {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, "groups.json"), "utf8"),
    ) as ForceGroup[];
  } catch {
    return [];
  }
}

export async function saveGroups(
  rootDir: string,
  groups: ForceGroup[],
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    path.join(rootDir, "groups.json"),
    JSON.stringify(groups, null, 2),
    "utf8",
  );
}

/** Seed default three groups from war picture + optional hero army ids. */
export function seedDefaultGroups(
  picture: WarPictureRaw | null | undefined,
  existing: ForceGroup[],
): ForceGroup[] {
  const byId = new Map(existing.map((g) => [g.id, g]));
  const now = new Date().toISOString();
  const own = picture?.ownArmies ?? [];

  const pgIskut = own.filter((a) =>
    /prince george|iskut|whitehorse/i.test(a.province ?? ""),
  );
  const sea = own.filter((a) => a.onSea);
  const papeete = own.filter((a) => /papeete|honolulu|belinyu/i.test(a.province ?? ""));
  const used = new Set<number>();

  const ensure = (
    role: GroupRole,
    name: string,
    armyIds: number[],
    province?: string,
    generalId?: string,
  ) => {
    const id = gid(role);
    const prev = byId.get(id);
    const ids = [...new Set([...(prev?.armyIds ?? []), ...armyIds])].filter(
      (n) => Number.isFinite(n),
    );
    for (const n of ids) used.add(n);
    byId.set(id, {
      id,
      name,
      role,
      generalId: generalId ?? prev?.generalId,
      armyIds: ids,
      province: province ?? prev?.province,
      mission: prev?.mission,
      updatedAt: now,
    });
  };

  ensure(
    "alaska_screen",
    "Alaska screen",
    pgIskut.map((a) => a.id),
    "Prince George",
  );
  ensure(
    "air_bridge",
    "Air bridge",
    papeete.map((a) => a.id),
    papeete[0]?.province ?? "Papeete",
  );

  const reserveIds = own
    .filter((a) => !used.has(a.id) && !a.onSea)
    .slice(0, 12)
    .map((a) => a.id);
  // Keep coastal fleet out of reserve by default — attach explicitly
  void sea;
  ensure("reserve", "Reserve", reserveIds, "rear");

  return [...byId.values()];
}

export async function attachArmyToGroup(
  rootDir: string,
  groupId: string,
  armyId: number,
): Promise<ForceGroup | null> {
  const groups = await loadGroups(rootDir);
  const g = groups.find((x) => x.id === groupId);
  if (!g) return null;
  if (!g.armyIds.includes(armyId)) g.armyIds.push(armyId);
  g.updatedAt = new Date().toISOString();
  await saveGroups(rootDir, groups);
  await getEventBus(rootDir).publish("HERO_ASSIGNED", {
    source: "groups",
    payload: { groupId, armyId },
  });
  return g;
}

export function formatGroupsBrief(groups: ForceGroup[]): string {
  if (!groups.length) return "(no force groups yet)";
  return groups
    .map(
      (g) =>
        `${g.name}: armies [${g.armyIds.slice(0, 8).join(", ")}]${g.province ? ` @ ${g.province}` : ""}${g.generalId ? ` cdr=${g.generalId}` : ""}`,
    )
    .join("\n");
}
