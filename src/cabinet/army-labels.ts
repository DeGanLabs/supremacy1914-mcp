import type { WarPictureRaw } from "./war-types.js";

function unitMix(
  units: ReadonlyArray<{ name?: string; size?: number }> | undefined,
): string {
  if (!units?.length) return "stack";
  return units
    .slice(0, 4)
    .map((u) => {
      const n = u.size ?? "?";
      const name = String(u.name ?? "unit").replace(/infantry/i, "inf");
      return `${n}×${name}`;
    })
    .join("+");
}

/** Human army label: "29×Inf @ New Arkhangelsk (17015164)". */
export function formatArmyLabel(
  picture: WarPictureRaw | null | undefined,
  armyId: number | undefined,
): string {
  if (armyId == null || !Number.isFinite(armyId)) return "army ?";
  const own = picture?.ownArmies?.find((a) => a.id === armyId);
  const foreign = picture?.foreignArmies?.find((a) => a.id === armyId);
  const a = own ?? foreign;
  if (!a) return `army ${armyId}`;
  const mix = unitMix(a.units);
  const prov = a.province?.trim() || "?";
  return `${mix} @ ${prov} (${armyId})`;
}

/** Resolve province id or fuzzy name to a display name. */
export function formatProvinceLabel(
  picture: WarPictureRaw | null | undefined,
  idOrName: string | number | undefined | null,
): string {
  if (idOrName == null || idOrName === "") return "?";
  const raw = String(idOrName).trim();
  if (!raw || raw === "?") return "?";

  const ownProv = picture?.ownProvinces ?? [];
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && /^\d+$/.test(raw)) {
    const byId = ownProv.find((p) => p.id === asNum);
    if (byId?.name) return byId.name;
    return `province ${raw}`;
  }

  const needle = raw.toLowerCase();
  const exact = ownProv.find((p) => p.name?.toLowerCase() === needle);
  if (exact?.name) return exact.name;
  const fuzzy = ownProv.find((p) => p.name?.toLowerCase().includes(needle));
  if (fuzzy?.name) return fuzzy.name;

  const armyHit = [
    ...(picture?.ownArmies ?? []),
    ...(picture?.foreignArmies ?? []),
  ].find((a) => a.province?.toLowerCase() === needle);
  if (armyHit?.province) return armyHit.province;

  return raw;
}

/** Resolve province name/id to numeric location id when known. */
export function resolveProvinceId(
  picture: WarPictureRaw | null | undefined,
  idOrName: string | number | undefined | null,
): number | string | null {
  if (idOrName == null || idOrName === "") return null;
  if (typeof idOrName === "number" && Number.isFinite(idOrName)) return idOrName;
  const raw = String(idOrName).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);

  const needle = raw.toLowerCase();
  const ownProv = picture?.ownProvinces ?? [];
  const exact = ownProv.find((p) => p.name?.toLowerCase() === needle);
  if (exact?.id != null) return exact.id;
  const fuzzy = ownProv.find(
    (p) =>
      p.name?.toLowerCase().includes(needle) ||
      needle.includes((p.name ?? "").toLowerCase()),
  );
  if (fuzzy?.id != null) return fuzzy.id;
  return raw;
}
