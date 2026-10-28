import { useState } from "react";
import type { FinancePicture, FinanceProvince, MapLayer } from "../types";
import { ACTION_EXPLAIN, LAYER_META } from "../theme";
import { layerValueLabel, provinceFill } from "../mapColors";
import { resourceIconUrl } from "../assets";
import { approveBuild } from "../api";
import { Button, Chip, EmptyState, MetricBlock, Panel } from "./ui";
import { useEffect, useRef } from "react";

function canApproveAction(
  a: FinanceProvince["bestAction"],
): a is NonNullable<FinanceProvince["bestAction"]> {
  if (!a) return false;
  if (a.action !== "constructBuilding" || a.upgradeId == null) return false;
  if (!a.affordable) return false;
  const blocked = a.blockedBy.filter((b) => b !== "none");
  return blocked.length === 0;
}

function costLine(a: NonNullable<FinanceProvince["bestAction"]>): string {
  const parts: string[] = [`$${a.cost}`];
  if (a.resourceCosts) {
    const extras = Object.entries(a.resourceCosts)
      .filter(([id]) => Number(id) !== 20)
      .map(([id, need]) => `#${id}:${need}`);
    if (extras.length) parts.push(extras.join(" "));
  }
  return parts.join(" · ");
}

export function ProvinceCard({
  province,
  layer,
  forecastH,
  onApproved,
}: {
  province: FinanceProvince | null;
  layer: MapLayer;
  forecastH: number;
  onApproved?: (picture?: FinancePicture) => void;
}) {
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const prevId = useRef<number | null>(null);

  useEffect(() => {
    if (province == null) return;
    if (prevId.current !== province.id) {
      prevId.current = province.id;
      setFlash(true);
      setStatus(null);
      const t = window.setTimeout(() => setFlash(false), 450);
      return () => window.clearTimeout(t);
    }
  }, [province?.id]);

  if (!province) {
    return (
      <Panel title="Province" className="province-card">
        <EmptyState>Select a province on the map or rankings.</EmptyState>
      </Panel>
    );
  }

  const a = province.bestAction;
  const ok = canApproveAction(a);
  const blocked =
    !!a && a.blockedBy.filter((b) => b !== "none").length > 0;

  const layerMeta = LAYER_META[layer];
  const layerValue = layerValueLabel(province, layer, forecastH);
  const fill = provinceFill(province, layer, forecastH);
  const icon = resourceIconUrl(province.resourceType);

  return (
    <Panel
      className={`province-card${flash ? " is-fresh" : ""}`}
      title={undefined}
    >
      <div className="province-hero" id="province-card-focus">
        <div
          className="province-swatch"
          style={{ background: fill }}
          aria-hidden
        />
        <div className="province-hero-text">
          <div className="province-name">{province.name}</div>
          <div className="province-sub muted">
            {province.role}
            {province.isDouble ? " · double" : ""}
            {province.coastal ? " · coastal" : ""}
          </div>
        </div>
        {icon && (
          <img
            className="province-res-icon"
            src={icon}
            alt={province.resourceType ?? ""}
            title={province.resourceType ?? ""}
          />
        )}
      </div>

      <div className="province-layer-sync">
        <span className="label">Map layer · {layerMeta?.label ?? layer}</span>
        <Chip mono tone="neutral">
          <i className="province-dot" style={{ background: fill }} />
          {layerValue}
        </Chip>
      </div>

      <MetricBlock label="What am I?">
        <div className="province-stats">
          <span>
            <em>Resource</em> {province.resourceType ?? "—"}
          </span>
          <span>
            <em>Prod</em> {province.mainProduction ?? "?"}
          </span>
          <span>
            <em>Morale</em>{" "}
            {province.morale != null ? `${Math.round(province.morale)}%` : "?"}
          </span>
          <span>
            <em>Eff</em> {province.efficiencyScore}
          </span>
          <span>
            <em>Infra</em> {province.infraScore}
          </span>
          <span>
            <em>Asset</em> {province.assetScore}
          </span>
        </div>
        {province.buildings.length > 0 && (
          <div className="muted" style={{ marginTop: 6 }}>
            Built:{" "}
            {province.buildings
              .map((b) => b.name)
              .filter(Boolean)
              .slice(0, 8)
              .join(" · ") || "—"}
          </div>
        )}
      </MetricBlock>

      <MetricBlock label="What is wrong?">
        <div>
          {province.failureCodes.length === 0 &&
          province.threatCodes.length === 0 &&
          !province.capitalWasted ? (
            <span className="muted">Nothing flagged</span>
          ) : null}
          {province.failureCodes.map((c) => (
            <div key={c} className="sev-high">
              ⚠ {c}
            </div>
          ))}
          {province.threatCodes.map((c) => (
            <div key={c} className="sev-medium">
              ○ {c}
            </div>
          ))}
          {province.capitalWasted && (
            <div>
              CAPITAL UNDERUTILIZED ({province.utilizationPct ?? "?"}%)
              invested ~${province.investedEstimate}
            </div>
          )}
        </div>
      </MetricBlock>

      <MetricBlock label="What should I do?">
        {a ? (
          <>
            <div>
              {a.upgradeName ?? a.action} · {costLine(a)} · prio {a.priority}
              {a.paybackHours != null ? ` · ROI ~${a.paybackHours}h` : ""}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              Why?{" "}
              {a.explainKeys.map((k) => ACTION_EXPLAIN[k] || k).join(" + ") ||
                "—"}
            </div>
            {!a.affordable && a.missingResources && a.missingResources.length > 0 && (
              <div className="sev-high" style={{ marginTop: 4 }}>
                Need:{" "}
                {a.missingResources
                  .map(
                    (m) =>
                      `${m.name} ${Math.round(m.have)}/${Math.round(m.need)}`,
                  )
                  .join(" · ")}
              </div>
            )}
            <div className="muted">
              Blocked by:{" "}
              {a.blockedBy.filter((b) => b !== "none").join(", ") || "none"}
            </div>
            <Button
              variant="primary"
              className="approve"
              style={{ marginTop: 8 }}
              disabled={!ok || busy}
              title={
                !a.affordable
                  ? "Not enough resources"
                  : blocked
                    ? `Blocked: ${a.blockedBy.filter((b) => b !== "none").join(", ")}`
                    : "Build now in game"
              }
              onClick={async () => {
                if (!a.upgradeId || !ok) return;
                setBusy(true);
                setStatus("Building…");
                const res = await approveBuild(province.name, a.upgradeId);
                setBusy(false);
                if (!res.ok) {
                  setStatus(res.error ?? "Build failed");
                  return;
                }
                setStatus("Built — stocks refreshed");
                onApproved?.(res.picture);
              }}
            >
              {busy ? "Building…" : "Approve"}
            </Button>
            {status && <div className="muted" style={{ marginTop: 6 }}>{status}</div>}
          </>
        ) : (
          <EmptyState>No candidate</EmptyState>
        )}
      </MetricBlock>

      {province.events.length > 0 && (
        <MetricBlock label="Events">
          {province.events.slice(-5).map((e, i) => (
            <div key={`${e.t}-${i}`} className="muted mono">
              {e.line}
            </div>
          ))}
        </MetricBlock>
      )}
    </Panel>
  );
}
