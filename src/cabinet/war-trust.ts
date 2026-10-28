import type { WarDiploRow, WarFrontRow, WarPictureRaw } from "./war-types.js";

/** Nations the player explicitly marked as distrusted. */
export function distrustNations(
  goals: ReadonlyArray<{ key: string; value: string }>,
): string[] {
  return goals
    .filter((g) => g.key.startsWith("distrust:"))
    .map((g) => g.value.toLowerCase() || g.key.slice("distrust:".length).toLowerCase());
}

export function isDistrusted(
  nation: string | undefined,
  playerId: number | undefined,
  goals: ReadonlyArray<{ key: string; value: string }>,
): boolean {
  const dist = distrustNations(goals);
  if (!dist.length) return false;
  const nat = (nation || "").toLowerCase();
  const pid = playerId != null ? `p${playerId}` : "";
  return dist.some((d) => nat.includes(d) || d === nat || d === pid);
}

/**
 * Trusted border partners: allies / coalition / share-map / NAP.
 * Right-of-way alone is NOT trusted — RoW is transit permission, not a security guarantee.
 */
export function trustedPlayerIds(picture: WarPictureRaw): Set<number> {
  const ids = new Set<number>();
  const d = picture.diplo;
  const push = (rows: readonly WarDiploRow[] | undefined) => {
    for (const r of rows ?? []) {
      if (r.id != null && !r.defeated) ids.add(r.id);
    }
  };
  push(d?.nap);
  push(d?.shareMapOrBetter);
  for (const id of (d as { allies?: number[] })?.allies ?? []) {
    if (typeof id === "number") ids.add(id);
  }
  for (const m of (d as { coalitionMembers?: WarDiploRow[] })?.coalitionMembers ?? []) {
    if (m.id != null) ids.add(m.id);
  }
  return ids;
}

export function isTrustedPlayer(
  picture: WarPictureRaw,
  playerId: number,
  goals: ReadonlyArray<{ key: string; value: string }>,
): boolean {
  if (isDistrusted(undefined, playerId, goals)) return false;
  return trustedPlayerIds(picture).has(playerId);
}

/** Share-map / view-military / NAP neighbor — not a war front. RoW alone is not enough. */
export function isShareMapFront(f: WarFrontRow): boolean {
  if (f.atWar) return false;
  const rel = String(f.relation ?? "").toLowerCase();
  return (
    rel.includes("view_military") ||
    rel.includes("share_map") ||
    rel === "nap"
  );
}

export function formatTrustedBlock(picture: WarPictureRaw): string[] {
  const d = picture.diplo as
    | (WarPictureRaw["diplo"] & {
        coalitionName?: string;
        allies?: number[];
        coalitionMembers?: WarDiploRow[];
      })
    | undefined;
  if (!d) return [];
  const lines: string[] = [];
  if (d.coalitionName) lines.push(`Coalition: ${d.coalitionName}`);
  const allyNames = (d.coalitionMembers ?? [])
    .map((m) => m.nation || m.name)
    .filter(Boolean)
    .slice(0, 8);
  if (allyNames.length) lines.push(`Allies/coalition: ${allyNames.join(", ")}`);
  const share = (d.shareMapOrBetter ?? [])
    .map((r) => r.nation || r.name)
    .filter(Boolean)
    .slice(0, 6);
  if (share.length) lines.push(`Share-map: ${share.join(", ")}`);
  const row = (d.rightOfWay ?? [])
    .map((r) => r.nation || r.name)
    .filter(Boolean)
    .slice(0, 4);
  if (row.length) {
    lines.push(`RoW (NOT trusted alone): ${row.join(", ")}`);
  }
  const nap = (d.nap ?? [])
    .map((r) => r.nation || r.name)
    .filter(Boolean)
    .slice(0, 4);
  if (nap.length) lines.push(`NAP: ${nap.join(", ")}`);
  return lines;
}

export function trustStandingBlock(
  goals: ReadonlyArray<{ key: string; value: string }>,
): string {
  const dist = distrustNations(goals);
  const base =
    "TRUST: allied/coalition/share-map/NAP borders are secure — do NOT strip garrisons there unless player orders it. RoW alone is NOT trusted.";
  if (!dist.length) return base;
  return `${base}\nDISTRUST override: ${dist.join(", ")} — treat those borders as uncertain; player correction wins.`;
}
