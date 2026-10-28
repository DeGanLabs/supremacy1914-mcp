import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { FinancePicture, FinanceProvince, MapLayer } from "../types";
import { LAYER_META, MAP, COLORS } from "../theme";
import {
  fitBounds,
  layerValueLabel,
  provinceFill,
  worldFromPx,
} from "../mapColors";
import { SEA, resourceIconUrl } from "../assets";
import { Button } from "./ui";

type Pt = { x: number; y: number };

/** Normalize ring from API (array or numeric-key object). */
function asRing(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const len =
      typeof o.length === "number"
        ? o.length
        : Object.keys(o).filter((k) => /^\d+$/.test(k)).length;
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      const v = Number(o[i]);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  }
  return [];
}

function ringPath(ring: readonly number[]): string | null {
  if (ring.length < 6) return null;
  let d = `M ${ring[0]} ${ring[1]}`;
  for (let i = 2; i + 1 < ring.length; i += 2) {
    d += ` L ${ring[i]} ${ring[i + 1]}`;
  }
  return `${d} Z`;
}

function provincePoints(p: FinanceProvince): Pt[] {
  const pts: Pt[] = [];
  for (const raw of p.borders ?? []) {
    const ring = asRing(raw);
    for (let i = 0; i + 1 < ring.length; i += 2) {
      pts.push({ x: ring[i]!, y: ring[i + 1]! });
    }
  }
  if (p.capital) pts.push(p.capital);
  if (p.bounds) {
    pts.push(
      { x: p.bounds.x, y: p.bounds.y },
      { x: p.bounds.x + p.bounds.w, y: p.bounds.y + p.bounds.h },
    );
  }
  return pts;
}

export function FinanceMap({
  picture,
  layer,
  forecastH,
  selectedId,
  onSelect,
}: {
  picture: FinancePicture;
  layer: MapLayer;
  forecastH: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const [fitMode, setFitMode] = useState<"cluster" | "all">("cluster");
  const [viewportW, setViewportW] = useState(640);
  const drag = useRef<{
    active: boolean;
    moved: boolean;
    ox: number;
    oy: number;
    px: number;
    py: number;
  } | null>(null);

  const fallback = picture.mapSize ?? MAP.defaultSize;
  const provinces = picture.provinces;
  const hasPolygons = provinces.some((p) => (p.borders?.length ?? 0) > 0);

  const fitPts = useMemo(() => {
    const all: Pt[] = [];
    for (const p of provinces) all.push(...provincePoints(p));
    return all;
  }, [provinces]);

  const bounds = useMemo(
    () => fitBounds(fitPts, fallback, { robust: fitMode === "cluster" }),
    [fitPts, fallback, fitMode],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [picture.generatedAt, fitMode, resetView]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setViewportW(el.clientWidth || 640);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    const zw = bounds.w / zoom;
    const zh = bounds.h / zoom;
    const cx = bounds.x + bounds.w / 2 - pan.x;
    const cy = bounds.y + bounds.h / 2 - pan.y;
    return {
      x: cx - zw / 2,
      y: cy - zh / 2,
      w: zw,
      h: zh,
    };
  }, [bounds, zoom, pan]);

  const u = useMemo(() => {
    const px = (n: number) => worldFromPx(view.w, n, viewportW);
    return {
      r: px(MAP.markerPx),
      rSel: px(MAP.markerSelectedPx),
      ring: px(MAP.ringPadPx),
      label: px(MAP.labelPx),
      stroke: px(1.35),
      badge: px(4.5),
      glow: px(14),
      icon: px(14),
      border: px(1.6),
    };
  }, [view.w, viewportW]);

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 / MAP.zoomStep : MAP.zoomStep;
    setZoom((z) => Math.min(MAP.zoomMax, Math.max(MAP.zoomMin, z * dir)));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as Element | null;
    // Province hits select; don't start a pan from them
    if (t?.closest?.("[data-province-id]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      active: true,
      moved: false,
      ox: e.clientX,
      oy: e.clientY,
      px: pan.x,
      py: pan.y,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d?.active) return;
    const el = wrapRef.current;
    if (!el) return;
    const dx = e.clientX - d.ox;
    const dy = e.clientY - d.oy;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    const rect = el.getBoundingClientRect();
    const scaleX = view.w / Math.max(1, rect.width);
    const scaleY = view.h / Math.max(1, rect.height);
    setPan({
      x: d.px + dx * scaleX,
      y: d.py + dy * scaleY,
    });
  };

  const selectProvince = (id: number) => {
    onSelect(id);
  };

  const endDrag = () => {
    if (drag.current) drag.current.active = false;
  };

  const hover = provinces.find((p) => p.id === hoverId) ?? null;
  const meta = LAYER_META[layer];
  const seaPad = Math.max(view.w, view.h);

  return (
    <div className="map-shell">
      <div className="map-toolbar">
        <div className="map-legend">
          <span className="map-legend-title">{meta?.label ?? layer}</span>
          {meta?.legend.map((item) => (
            <span key={item.text} className="map-legend-item">
              <i className={`swatch swatch-${item.tone}`} />
              {item.text}
            </span>
          ))}
          {hasPolygons && (
            <span className="map-legend-item muted">Real borders</span>
          )}
        </div>
        <div className="map-tools">
          <Button
            variant="ghost"
            className={fitMode === "cluster" ? "is-active" : ""}
            onClick={() => {
              setFitMode("cluster");
              resetView();
            }}
          >
            Cluster
          </Button>
          <Button
            variant="ghost"
            className={fitMode === "all" ? "is-active" : ""}
            onClick={() => {
              setFitMode("all");
              resetView();
            }}
          >
            All
          </Button>
          <Button
            variant="ghost"
            aria-label="Zoom out"
            onClick={() =>
              setZoom((z) => Math.max(MAP.zoomMin, z / MAP.zoomStep))
            }
          >
            −
          </Button>
          <span className="mono muted map-zoom-label">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            aria-label="Zoom in"
            onClick={() =>
              setZoom((z) => Math.min(MAP.zoomMax, z * MAP.zoomStep))
            }
          >
            +
          </Button>
          <Button variant="ghost" onClick={resetView}>
            Fit
          </Button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="map-wrap map-wrap-real"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <svg
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="map-svg"
        >
          <defs>
            <radialGradient id="seaGlow" cx="50%" cy="40%" r="75%">
              <stop offset="0%" stopColor={SEA.shallow} stopOpacity="0.95" />
              <stop offset="55%" stopColor={SEA.mid} stopOpacity="1" />
              <stop offset="100%" stopColor={SEA.deep} stopOpacity="1" />
            </radialGradient>
            <pattern
              id="seaRipple"
              patternUnits="userSpaceOnUse"
              width={Math.max(40, view.w / 18)}
              height={Math.max(28, view.h / 18)}
            >
              <path
                d={`M 0 ${Math.max(14, view.h / 36)} Q ${Math.max(20, view.w / 36)} 0 ${Math.max(40, view.w / 18)} ${Math.max(14, view.h / 36)}`}
                fill="none"
                stroke={SEA.foam}
                strokeOpacity="0.08"
                strokeWidth={Math.max(0.6, view.w / 900)}
              />
            </pattern>
            <linearGradient id="landShade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.2" />
            </linearGradient>
            <filter id="landShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow
                dx={u.stroke}
                dy={u.stroke}
                stdDeviation={u.stroke}
                floodColor="#041018"
                floodOpacity="0.5"
              />
            </filter>
          </defs>

          <rect
            x={view.x - seaPad}
            y={view.y - seaPad}
            width={view.w + seaPad * 2}
            height={view.h + seaPad * 2}
            fill="url(#seaGlow)"
          />
          <rect
            x={view.x - seaPad}
            y={view.y - seaPad}
            width={view.w + seaPad * 2}
            height={view.h + seaPad * 2}
            fill="url(#seaRipple)"
          />

          {provinces.map((p) => {
            const fill = provinceFill(p, layer, forecastH);
            const selected = p.id === selectedId;
            const hovered = p.id === hoverId;
            const rings = (p.borders ?? []).map(asRing).filter((r) => r.length >= 6);
            if (!rings.length) return null;
            return (
              <g
                key={`poly-${p.id}`}
                data-province-id={p.id}
                className={`map-land${selected ? " is-selected" : ""}${hovered ? " is-hover" : ""}`}
                style={{ cursor: "pointer" }}
                filter="url(#landShadow)"
                onPointerUp={(e) => {
                  e.stopPropagation();
                  selectProvince(p.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectProvince(p.id);
                }}
                onPointerEnter={() => setHoverId(p.id)}
                onPointerLeave={() =>
                  setHoverId((id) => (id === p.id ? null : id))
                }
              >
                {rings.map((ring, i) => {
                  const d = ringPath(ring);
                  if (!d) return null;
                  return (
                    <path
                      key={i}
                      d={d}
                      fill={fill}
                      fillOpacity={selected || hovered ? 0.92 : 0.82}
                      stroke={selected ? COLORS.selected : "#0a1820"}
                      strokeWidth={selected ? u.border * 1.8 : u.border}
                    />
                  );
                })}
                <path
                  d={rings.map((r) => ringPath(r)).filter(Boolean).join(" ")}
                  fill="url(#landShade)"
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {provinces.map((p) => {
            const c = p.capital;
            if (!c) return null;
            const selected = p.id === selectedId;
            const hovered = p.id === hoverId;
            const fill = provinceFill(p, layer, forecastH);
            const r = selected || hovered ? u.rSel : u.r;
            const icon = resourceIconUrl(p.resourceType);
            const showLabel =
              selected || hovered || zoom >= 1.2 || !hasPolygons;
            return (
              <g
                key={`cap-${p.id}`}
                data-province-id={p.id}
                style={{ cursor: "pointer" }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  selectProvince(p.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectProvince(p.id);
                }}
                onPointerEnter={() => setHoverId(p.id)}
                onPointerLeave={() =>
                  setHoverId((id) => (id === p.id ? null : id))
                }
              >
                {(selected || hovered) && (
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={r + u.glow}
                    fill={fill}
                    opacity={0.22}
                  />
                )}
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={r}
                  fill="#142018"
                  stroke={selected ? COLORS.selected : "rgba(232,230,217,0.85)"}
                  strokeWidth={u.stroke}
                />
                {icon ? (
                  <image
                    href={icon}
                    x={c.x - u.icon / 2}
                    y={c.y - u.icon / 2}
                    width={u.icon}
                    height={u.icon}
                    preserveAspectRatio="xMidYMid meet"
                  />
                ) : (
                  <circle cx={c.x} cy={c.y} r={r * 0.45} fill={fill} />
                )}
                {p.failureCodes.length > 0 && (
                  <circle
                    cx={c.x + r * 0.75}
                    cy={c.y - r * 0.75}
                    r={u.badge}
                    fill={COLORS.bad}
                    stroke="#0d1c22"
                    strokeWidth={u.stroke * 0.8}
                  />
                )}
                {showLabel && (
                  <text
                    x={c.x}
                    y={c.y + r + u.label * 1.2}
                    textAnchor="middle"
                    className="map-label"
                    fill={COLORS.ink}
                    fontSize={u.label}
                    strokeWidth={u.stroke * 2.2}
                  >
                    {p.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hover && (
          <div className="map-tooltip" role="tooltip">
            <strong>{hover.name}</strong>
            <div className="muted">
              {hover.role}
              {hover.isDouble ? " · double" : ""}
              {hover.coastal ? " · coastal" : ""}
            </div>
            <div className="mono">
              {meta?.label ?? layer}: {layerValueLabel(hover, layer, forecastH)}
            </div>
            {hover.bestAction && (
              <div className="map-tooltip-action">
                Next: {hover.bestAction.upgradeName ?? hover.bestAction.action}
              </div>
            )}
          </div>
        )}

        {provinces.length === 0 && (
          <div className="map-empty">
            No province coordinates — connect the game bridge and refresh.
          </div>
        )}
      </div>

      <p className="map-hint muted">
        {hasPolygons
          ? "Live Supremacy borders · ocean backdrop · drag / scroll / Cluster·All"
          : "Waiting for border dump — Refresh after bridge reconnect"}
      </p>
    </div>
  );
}
