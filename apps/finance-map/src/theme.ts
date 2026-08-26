/** Shared visual + domain tokens — keep UI free of magic numbers. */

export const STATUS = {
  good: "good",
  warn: "warn",
  bad: "bad",
  neutral: "neutral",
} as const;

export type StatusTone = (typeof STATUS)[keyof typeof STATUS];

/** CSS color fallbacks when SVG cannot use var() reliably */
export const COLORS = {
  good: "#6aab6e",
  warn: "#d4a017",
  bad: "#c45c4a",
  muted: "#4a5540",
  ink: "#e8e6d9",
  accent: "#c4a35a",
  mapBg: "#0e100c",
  mapGrid: "#1c2218",
  mapStroke: "#2a3226",
  selected: "#c4a35a",
  resource: {
    iron: "#8a9aaa",
    grain: "#8aaa6a",
    oil: "#6a6a4a",
    wood: "#5a7a4a",
    default: "#6a7a8a",
  },
  capitalOk: "#4a6a8a",
} as const;

export const THRESHOLDS = {
  morale: { good: 75, warn: 50 },
  efficiency: { good: 80, warn: 50 },
  warPressure: { high: 0.5, med: 0.2 },
  failureMany: 2,
} as const;

export const MAP = {
  /** Target on-screen marker radius in CSS pixels */
  markerPx: 10,
  markerSelectedPx: 14,
  ringPadPx: 5,
  labelPx: 11,
  fitPaddingRatio: 0.08,
  fitPaddingMin: 40,
  minSpan: 280,
  /** IQR multiplier for excluding geographic outliers from default fit */
  outlierIqr: 1.8,
  defaultSize: { width: 2000, height: 1200 },
  zoomMin: 0.35,
  zoomMax: 6,
  zoomStep: 1.25,
  linkMaxFrac: 0.18,
} as const;

export const POLL_MS = 60_000;

export const FORECAST_HOURS = [0, 6, 12, 24] as const;

export const VIEW_TABS = [
  { id: "map", label: "Map" },
  { id: "table", label: "Portfolio" },
  { id: "market", label: "Market" },
  { id: "forecast", label: "Forecast" },
  { id: "simulate", label: "Simulate" },
] as const;

export type ViewTabId = (typeof VIEW_TABS)[number]["id"];

export const MODE_OPTIONS = [
  { id: "economy", label: "Economy" },
  { id: "warEconomy", label: "War economy" },
  { id: "emergency", label: "Emergency" },
] as const;

export const LAYER_META: Record<
  string,
  { label: string; legend: { tone: StatusTone; text: string }[] }
> = {
  RESOURCE: {
    label: "Resource",
    legend: [
      { tone: "neutral", text: "By resource type" },
      { tone: "good", text: "Grain / food" },
      { tone: "warn", text: "Oil" },
      { tone: "neutral", text: "Iron / other" },
    ],
  },
  MORALE: {
    label: "Morale",
    legend: [
      { tone: "good", text: `≥${THRESHOLDS.morale.good}%` },
      { tone: "warn", text: `${THRESHOLDS.morale.warn}–${THRESHOLDS.morale.good - 1}%` },
      { tone: "bad", text: `<${THRESHOLDS.morale.warn}%` },
    ],
  },
  FAILURE: {
    label: "Failure",
    legend: [
      { tone: "bad", text: "2+ failures" },
      { tone: "warn", text: "1 failure" },
      { tone: "neutral", text: "Clear" },
    ],
  },
  EFFICIENCY: {
    label: "Efficiency",
    legend: [
      { tone: "good", text: `≥${THRESHOLDS.efficiency.good}` },
      { tone: "warn", text: `${THRESHOLDS.efficiency.warn}–${THRESHOLDS.efficiency.good - 1}` },
      { tone: "bad", text: `<${THRESHOLDS.efficiency.warn}` },
    ],
  },
  CAPITAL: {
    label: "Capital",
    legend: [
      { tone: "bad", text: "Wasted / idle" },
      { tone: "neutral", text: "Utilized" },
    ],
  },
  FORECAST: {
    label: "Forecast",
    legend: [
      { tone: "bad", text: "Critical" },
      { tone: "warn", text: "Warning" },
      { tone: "neutral", text: "Stable" },
    ],
  },
  WAR_ECONOMY: {
    label: "War pressure",
    legend: [
      { tone: "bad", text: `>${THRESHOLDS.warPressure.high}` },
      { tone: "warn", text: `>${THRESHOLDS.warPressure.med}` },
      { tone: "neutral", text: "Low" },
    ],
  },
  MARKET: {
    label: "Market",
    legend: [
      { tone: "good", text: "BUY" },
      { tone: "warn", text: "WATCH" },
      { tone: "bad", text: "AVOID" },
    ],
  },
};

export const ACTION_EXPLAIN: Record<string, string> = {
  DOUBLE_RESOURCE: "Double-resource province",
  FACTORY_MISSING: "Factory missing",
  WORKSHOP_MISSING: "Workshop missing",
  RAIL_MISSING: "Railway missing",
  BARRACKS_OVERBURN: "Barracks while grain stressed",
  IRON_BOTTLENECK: "Relieves iron bottleneck",
  GRAIN_BOTTLENECK: "Tied to grain bottleneck",
  OIL_BOTTLENECK: "Tied to oil bottleneck",
  MONEY_BOTTLENECK: "Cash constrained",
  SAFE_RESERVE: "Safe vs reserve floor",
  LOW_MORALE: "Low morale",
  RICH_IDLE: "Rich / underbuilt",
  CAPITAL_WASTED: "Capital underutilized",
  WAR_DEMAND: "Supports war demand",
  AFFORDABLE: "Affordable now",
  MARKET_SPREAD: "Market edge",
};

export function toneColor(tone: StatusTone): string {
  if (tone === STATUS.good) return COLORS.good;
  if (tone === STATUS.warn) return COLORS.warn;
  if (tone === STATUS.bad) return COLORS.bad;
  return COLORS.muted;
}

export function chipToneFromRate(rate: number, critical: boolean): StatusTone {
  if (critical) return STATUS.bad;
  if (rate < 0) return STATUS.warn;
  return STATUS.good;
}
