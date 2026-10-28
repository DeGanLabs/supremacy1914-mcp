import type { WarPictureRaw, WarWatchSnapshot } from "./war-types.js";

/**
 * war-picture.json is usually a WarWatchSnapshot `{ picture: WarPictureRaw, ... }`.
 * Some callers expect the inner WarPictureRaw (ownArmies / ownProvinces).
 */
export function unwrapWarPicture(
  snap: unknown,
): WarPictureRaw | null {
  if (!snap || typeof snap !== "object") return null;
  const o = snap as Partial<WarWatchSnapshot> & Partial<WarPictureRaw>;
  if (o.picture && typeof o.picture === "object") {
    return o.picture as WarPictureRaw;
  }
  if (Array.isArray(o.ownArmies) || Array.isArray(o.ownProvinces)) {
    return o as WarPictureRaw;
  }
  return null;
}
