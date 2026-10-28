import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { FinanceMode, FinancePicture, MapLayer } from "./types";
import { ALL_LAYERS } from "./types";
import { fetchPicture, refreshPicture, runWhatIf, setMode } from "./api";
import {
  FORECAST_HOURS,
  LAYER_META,
  MODE_OPTIONS,
  POLL_MS,
  VIEW_TABS,
  type ViewTabId,
} from "./theme";
import { Button, Panel, SegmentedControl } from "./components/ui";
import { HealthStrip } from "./components/HealthStrip";
import { FailureThreatList } from "./components/FailureThreatList";
import { RankingsPanel } from "./components/RankingsPanel";
import { FinanceMap } from "./components/FinanceMap";
import { ProvinceCard } from "./components/ProvinceCard";
import { DoNext } from "./components/DoNext";
import {
  FinanceBriefPanel,
  WarPressureCard,
} from "./components/FinanceBriefPanel";
import {
  MarketPanel,
  TableView,
  WhatIfPanel,
} from "./components/MarketPanel";

const LAYER_OPTIONS = ALL_LAYERS.map((id) => ({
  id,
  label: LAYER_META[id]?.label ?? id,
}));

export default function App() {
  const [picture, setPicture] = useState<FinancePicture | null>(null);
  const [layer, setLayer] = useState<MapLayer>("EFFICIENCY");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [forecastH, setForecastH] = useState(12);
  const [tab, setTab] = useState<ViewTabId>("map");
  const [whatIf, setWhatIf] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  const applyPicture = (p: FinancePicture) => {
    setPicture(p);
    setSelectedId((prev) => {
      if (prev != null && p.provinces.some((x) => x.id === prev)) return prev;
      return p.provinces[0]?.id ?? null;
    });
  };

  const load = async () => {
    setErr(null);
    const p = await fetchPicture();
    if (!p) {
      setErr(
        "No finance picture — start finance:engine or cabinet, or use fixture",
      );
      return;
    }
    applyPicture(p);
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, []);

  const selectProvince = (id: number) => {
    setSelectedId(id);
    requestAnimationFrame(() => {
      document
        .getElementById("province-card-focus")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const onBuildApproved = (pic?: FinancePicture) => {
    if (pic) applyPicture(pic);
    else void load();
  };

  const selected = useMemo(
    () => picture?.provinces.find((p) => p.id === selectedId) ?? null,
    [picture, selectedId],
  );

  if (!picture) {
    return (
      <div className="app app-loading">
        <Panel title="Financial Command Center">
          <p className="muted">{err ?? "Loading…"}</p>
          <Button variant="primary" onClick={() => void load()}>
            Retry / load fixture
          </Button>
        </Panel>
      </div>
    );
  }

  const mode = picture.national.mode;

  return (
    <div className="app">
      <HealthStrip picture={picture} />

      <div className="main">
        <div className="col col-left">
          <FailureThreatList
            picture={picture}
            onSelectProvince={selectProvince}
            selectedId={selectedId}
          />
          <RankingsPanel
            picture={picture}
            onSelectProvince={selectProvince}
            selectedId={selectedId}
          />
          <FinanceBriefPanel picture={picture} />
        </div>

        <div className="col col-center">
          <Panel className="workspace">
            <div className="workspace-toolbar">
              <div className="toolbar-group">
                <SegmentedControl
                  options={VIEW_TABS}
                  value={tab}
                  onChange={setTab}
                />
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const p = await refreshPicture();
                    if (p) applyPicture(p);
                  }}
                >
                  Refresh
                </Button>
              </div>
              <SegmentedControl
                size="sm"
                options={MODE_OPTIONS}
                value={mode}
                onChange={async (m) => {
                  const p = await setMode(m as FinanceMode);
                  if (p) setPicture(p);
                }}
              />
            </div>

            <div className="workspace-body">
              {tab === "map" && (
                <>
                  <SegmentedControl
                    size="sm"
                    className="layers"
                    options={LAYER_OPTIONS}
                    value={layer}
                    onChange={setLayer}
                  />
                  <FinanceMap
                    picture={picture}
                    layer={layer}
                    forecastH={forecastH}
                    selectedId={selectedId}
                    onSelect={selectProvince}
                  />
                </>
              )}
              {tab === "table" && (
                <TableView
                  picture={picture}
                  onSelect={selectProvince}
                  selectedId={selectedId}
                />
              )}
              {tab === "market" && <MarketPanel picture={picture} />}
              {tab === "forecast" && (
                <div>
                  <h2>Forecast horizon</h2>
                  <SegmentedControl
                    size="sm"
                    options={FORECAST_HOURS.map((h) => ({
                      id: String(h),
                      label: h === 0 ? "NOW" : `${h}h`,
                    }))}
                    value={String(forecastH)}
                    onChange={(id) => {
                      const h = Number(id);
                      setForecastH(h === 0 ? 6 : h);
                      setLayer("FORECAST");
                      setTab("map");
                    }}
                  />
                  <p className="muted" style={{ marginTop: 10 }}>
                    Now {picture.national.forecasts.statusNow} · 6h{" "}
                    {picture.national.forecasts.status6h} · 12h{" "}
                    {picture.national.forecasts.status12h} · 24h{" "}
                    {picture.national.forecasts.status24h}
                  </p>
                </div>
              )}
              {tab === "simulate" && (
                <WhatIfPanel
                  result={whatIf}
                  onRun={async () => {
                    const barracks = picture.provinces
                      .filter((p) =>
                        p.buildings.some((b) => /barrack/i.test(b.name ?? "")),
                      )
                      .map((p) => p.id);
                    const res = await runWhatIf({
                      hours: 24,
                      disableBarracksProvinceIds: barracks.slice(0, 2),
                      buyResource: [{ resourceId: 1, amount: 1000 }],
                    });
                    setWhatIf(res);
                  }}
                />
              )}
            </div>
          </Panel>
          <DoNext
            picture={picture}
            onSelectProvince={selectProvince}
            onApproved={onBuildApproved}
            compact={tab === "map"}
          />
        </div>

        <div className="col col-right">
          <ProvinceCard
            province={selected}
            layer={layer}
            forecastH={forecastH}
            onApproved={onBuildApproved}
          />
          <WarPressureCard picture={picture} />
        </div>
      </div>
    </div>
  );
}
