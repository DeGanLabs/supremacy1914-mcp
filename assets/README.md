# Supremacy 1914 assets

Official **Ultimate client** icons from:

`https://www.supremacy1914.com/clients/s1914-client-ultimate/s1914-client-ultimate_live/images/`

Re-download: `node scripts/download-s1914-assets.mjs`

© Bytro / Stillfront — personal tools / cabinet UI only; do not redistribute as a standalone pack.

## Curated folders (what you asked for)

| Folder | Contents | Count (approx) |
|--------|----------|----------------|
| **`buildings/`** | Buildings only — icons, portraits, level badges | ~172 |
| **`units_weapons/`** | Units + weapons only — icons, portraits, features, premium unlock | ~455 |
| **`heroes/`** | Heroes only — portraits, borders, levels, rarity, shards | ~329 |

### Detail

```
buildings/
  icons/       # barracks, factory, fortress, harbour, …
  portraits/   # large building art
  levels/      # level badge overlays

units_weapons/
  icons/           # infantry, artillery, ships, planes, …
  portraits/       # large unit / weapon art
  features/        # unit feature badges
  premium_unlock/  # premium unit teasers

heroes/
  unit/        # hero portraits (+ _bg backgrounds)
  border/ levels/ rarity/ shards/ tutorial/  # hero chrome
```

## Other UI (unchanged)

`icons/`, `resources/`, `diplomacy/`, `espionage/`, `inventory/`, `avatars/`, `chat/`, …

## Naming tips

- Units / buildings: `{name}_s{level}.png` — prefer `_s1`; `@2x` is retina.
- Heroes: `heroes/unit/{slug}.png` (+ `_bg`).

## Manifests

- `manifest.json` — files present per category  
- `image-properties.*.json` — client catalog metadata  
- `download-report.json` — last download stats  
