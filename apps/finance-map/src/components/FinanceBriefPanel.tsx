import type { FinancePicture } from "../types";
import { EmptyState, ListRow, Panel, ProgressBar } from "./ui";

export function FinanceBriefPanel({ picture }: { picture: FinancePicture }) {
  const b = picture.national.financeBrief;
  const rows = [
    ["Economy", b.economyLine],
    ["Bottleneck", b.bottleneckLine],
    ["Do next", b.doNextLine],
    ["Capital", b.capitalLine],
    ["Market", b.marketLine],
    ["War", b.warLine],
    ["Risk", b.riskLine],
  ] as const;

  return (
    <Panel title="Finance brief">
      {rows.map(([label, line]) => (
        <ListRow key={label}>
          <strong>{label}</strong> {line}
        </ListRow>
      ))}
    </Panel>
  );
}

export function WarPressureCard({ picture }: { picture: FinancePicture }) {
  const ops = picture.national.warDemand.filter((w) => w.status === "active");
  return (
    <Panel title="War pressure">
      {ops.length === 0 && <EmptyState>No active warDemand</EmptyState>}
      {ops.map((op) => (
        <div key={op.operationId} style={{ marginBottom: 8 }}>
          <div>
            <strong>{op.name}</strong>
          </div>
          {Object.entries(op.needed).map(([k, need]) => {
            const row = picture.national.resources.find(
              (r) => r.name.toLowerCase() === k.toLowerCase(),
            );
            const have = row?.amount ?? 0;
            const pct = Math.min(100, (have / Math.max(1, need)) * 100);
            return (
              <div key={k} style={{ marginTop: 4 }}>
                <div className="muted">
                  {k} {Math.round(have)} / {need}
                </div>
                <ProgressBar value={pct} tone={pct >= 100 ? "good" : "warn"} />
              </div>
            );
          })}
        </div>
      ))}
    </Panel>
  );
}
