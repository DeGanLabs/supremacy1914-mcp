import type { FinancePicture } from "../types";
import { chipToneFromRate, STATUS } from "../theme";
import { statusToneFromForecast } from "../mapColors";
import { Chip, ProgressBar } from "./ui";

export function HealthStrip({ picture }: { picture: FinancePicture }) {
  const n = picture.national;
  const h = n.health;
  const statusTone = statusToneFromForecast(n.forecasts.statusNow);

  return (
    <div className="panel health-strip">
      <div>
        <div className="muted">Economic health</div>
        <div className="health-score">{h.total}/100</div>
        <ProgressBar value={h.total} tone={statusTone} className="health-bar" />
        <div className="health-dims">
          <span>P {h.production}</span>
          <span>L {h.liquidity}</span>
          <span>R {h.reserves}</span>
          <span>I {h.infrastructure}</span>
          <span>T {h.trade}</span>
          <span>Risk {h.risk}</span>
        </div>
      </div>
      <div>
        <div className="chips">
          <Chip tone={statusTone}>
            Status {n.forecasts.statusNow} · 6h {n.forecasts.status6h} · 12h{" "}
            {n.forecasts.status12h} · 24h {n.forecasts.status24h}
          </Chip>
          <Chip tone={n.bottleneck ? STATUS.warn : STATUS.neutral}>
            Bottleneck {n.bottleneck?.name ?? "—"}
          </Chip>
          <Chip
            tone={
              n.dataQuality.percent < 50
                ? STATUS.bad
                : n.dataQuality.percent < 80
                  ? STATUS.warn
                  : STATUS.good
            }
          >
            Data {n.dataQuality.percent}%
          </Chip>
          <Chip mono>
            ${Math.round(n.money)}
            {n.moneyRate != null
              ? ` (${n.moneyRate >= 0 ? "+" : ""}${n.moneyRate.toFixed(1)}/h)`
              : ""}
          </Chip>
          {n.resources.slice(0, 8).map((r) => (
            <Chip
              key={r.id}
              mono
              tone={chipToneFromRate(r.rate, r.isCritical)}
              title={`${r.name}: stock ${Math.round(r.amount)}`}
            >
              {r.name} {r.rate >= 0 ? "+" : ""}
              {r.rate.toFixed(1)}/h
              {r.hoursToZero != null ? ` · ${r.hoursToZero.toFixed(0)}h` : ""}
            </Chip>
          ))}
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
          {Object.entries(n.dataQuality.sources)
            .map(([k, v]) => `${k}:${v}`)
            .join(" · ")}
        </div>
      </div>
      <div className="muted mono" style={{ fontSize: 11 }}>
        {new Date(picture.generatedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}
