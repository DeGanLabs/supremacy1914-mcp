import type { FinanceProvince, MapLayer } from "./types";
import {
  COLORS,
  MAP,
  THRESHOLDS,
  toneColor,
  STATUS,
  type StatusTone,
} from "./theme";

export function provinceFill(
  p: FinanceProvince,
  layer: MapLayer,
  forecastH: number,
): string {
  if (layer === "MORALE") {
    const m = p.morale ?? 50;
    if (m >= THRESHOLDS.morale.good) return COLORS.good;
    if (m >= THRESHOLDS.morale.warn) return COLORS.warn;
    return COLORS.bad;
  }
  if (layer === "EFFICIENCY") {
    if (p.efficiencyScore >= THRESHOLDS.efficiency.good) return COLORS.good;
    if (p.efficiencyScore >= THRESHOLDS.efficiency.warn) return COLORS.warn;
    return COLORS.bad;
  }
  if (layer === "FAILURE") {
    if (p.failureCodes.length >= THRESHOLDS.failureMany) return COLORS.bad;
    if (p.failureCodes.length === 1) return COLORS.warn;
    return COLORS.muted;
  }
  if (layer === "CAPITAL") {
    return p.capitalWasted ? COLORS.bad : COLORS.capitalOk;
  }
  if (layer === "FORECAST") {
    const key =
      forecastH <= 6
        ? p.forecasts.at6h
        : forecastH <= 12
          ? p.forecasts.at12h
          : p.forecasts.at24h;
    if (key === "critical") return COLORS.bad;
    if (key === "warning") return COLORS.warn;
    return COLORS.muted;
  }
  if (layer === "WAR_ECONOMY") {
    if (p.warPressure > THRESHOLDS.warPressure.high) return COLORS.bad;
    if (p.warPressure > THRESHOLDS.warPressure.med) return COLORS.warn;
    return COLORS.muted;
  }
  if (layer === "MARKET") {
    if (p.marketHint === "BUY") return COLORS.good;
    if (p.marketHint === "WATCH") return COLORS.warn;
    if (p.marketHint === "AVOID") return COLORS.bad;
    return COLORS.muted;
  }
  const rt = (p.resourceType || "").toLowerCase();
  if (/iron|eisen/.test(rt)) return COLORS.resource.iron;
  if (/grain|food|fisch/.test(rt)) return COLORS.resource.grain;
  if (/oil|öl/.test(rt)) return COLORS.resource.oil;
  if (/wood|holz/.test(rt)) return COLORS.resource.wood;
  return COLORS.resource.default;
}

export function layerValueLabel(
  p: FinanceProvince,
  layer: MapLayer,
  forecastH: number,
): string {
  switch (layer) {
    case "MORALE":
      return p.morale != null ? `${Math.round(p.morale)}%` : "—";
    case "EFFICIENCY":
      return String(p.efficiencyScore);
    case "FAILURE":
      return p.failureCodes.length ? p.failureCodes.join(", ") : "clear";
    case "CAPITAL":
      return p.capitalWasted
        ? `idle ${p.utilizationPct ?? "?"}%`
        : `ok ${p.utilizationPct ?? "?"}%`;
    case "FORECAST": {
      const key =
        forecastH <= 6
          ? p.forecasts.at6h
          : forecastH <= 12
            ? p.forecasts.at12h
            : p.forecasts.at24h;
      return key ?? "stable";
    }
    case "WAR_ECONOMY":
      return p.warPressure.toFixed(2);
    case "MARKET":
      return p.marketHint || "—";
    default:
      return p.resourceType ?? "—";
  }
}

type Pt = { x: number; y: number };

function extentOf(points: Pt[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function quartile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** Drop IQR outliers so one distant colony doesn't crush the homeland view. */
export function clusterPoints(points: Pt[], iqrK = MAP.outlierIqr): Pt[] {
  if (points.length < 4) return points;
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const x1 = quartile(xs, 0.25);
  const x3 = quartile(xs, 0.75);
  const y1 = quartile(ys, 0.25);
  const y3 = quartile(ys, 0.75);
  const ix = Math.max(1, (x3 - x1) * iqrK);
  const iy = Math.max(1, (y3 - y1) * iqrK);
  const kept = points.filter(
    (p) =>
      p.x >= x1 - ix &&
      p.x <= x3 + ix &&
      p.y >= y1 - iy &&
      p.y <= y3 + iy,
  );
  return kept.length >= 3 ? kept : points;
}

export function fitBounds(
  points: Pt[],
  fallback: { width: number; height: number },
  opts: { robust?: boolean } = { robust: true },
): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) {
    return { x: 0, y: 0, w: fallback.width, h: fallback.height };
  }
  const used = opts.robust ? clusterPoints(points) : points;
  const { minX, minY, maxX, maxY } = extentOf(used);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const pad = Math.max(
    MAP.fitPaddingMin,
    Math.max(spanX, spanY) * MAP.fitPaddingRatio,
  );
  const w = Math.max(MAP.minSpan, spanX + pad * 2);
  const h = Math.max(MAP.minSpan, spanY + pad * 2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Convert desired CSS pixels → world units for the current viewBox width. */
export function worldFromPx(viewW: number, cssPx: number, viewportW: number): number {
  const vw = Math.max(1, viewportW);
  return (viewW / vw) * cssPx;
}

export function statusToneFromForecast(s: string): StatusTone {
  const v = s.toLowerCase();
  if (v.includes("crit")) return STATUS.bad;
  if (v.includes("warn")) return STATUS.warn;
  if (v.includes("ok") || v.includes("stable") || v.includes("good"))
    return STATUS.good;
  return STATUS.neutral;
}

export { toneColor, COLORS, MAP };
