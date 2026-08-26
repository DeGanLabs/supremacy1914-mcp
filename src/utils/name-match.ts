/** Exact name match, else a unique substring hit. Ambiguous → null. */
export function uniqueNameMatch<T>(
  items: readonly T[],
  needle: string,
  getName: (item: T) => string | null | undefined,
): T | null {
  const n = needle.trim().toLowerCase();
  if (!n) return null;
  const named = items.map((item) => ({
    item,
    name: (getName(item) ?? "").trim().toLowerCase(),
  }));
  const exact = named.filter((x) => x.name === n);
  if (exact.length === 1) return exact[0]!.item;
  if (exact.length > 1) return null;
  const partial = named.filter(
    (x) =>
      x.name.length >= 3 &&
      n.length >= 3 &&
      (x.name.includes(n) || n.includes(x.name)),
  );
  return partial.length === 1 ? partial[0]!.item : null;
}
