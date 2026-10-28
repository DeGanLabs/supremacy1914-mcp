import type { FinancePicture } from "../types";
import { Button, EmptyState, ListRow } from "./ui";

export function MarketPanel({ picture }: { picture: FinancePicture }) {
  return (
    <div>
      <h2>Market</h2>
      {picture.national.market.length === 0 && (
        <EmptyState>No book data</EmptyState>
      )}
      {picture.national.market.map((m) => (
        <ListRow key={m.resourceId}>
          <strong>{m.name}</strong>{" "}
          <span
            className={
              m.hint === "BUY" ? "good" : m.hint === "AVOID" ? "sev-high" : ""
            }
          >
            {m.hint}
          </span>
          <div className="mono muted">
            buy {m.buy ?? "—"} · sell {m.sell ?? "—"} · fee {m.feePct}% · net{" "}
            {m.netMarginPct != null ? `${m.netMarginPct.toFixed(1)}%` : "—"}
          </div>
        </ListRow>
      ))}
      <h3>Embargoes</h3>
      {picture.national.embargoes.length === 0 && (
        <EmptyState>None listed</EmptyState>
      )}
      {picture.national.embargoes.map((e, i) => (
        <ListRow key={i} className="muted">
          {e.line}
        </ListRow>
      ))}
    </div>
  );
}

export function WhatIfPanel({
  onRun,
  result,
}: {
  onRun: () => void;
  result: unknown;
}) {
  return (
    <div className="whatif">
      <h2>Simulate 24h</h2>
      <p className="muted">
        Deterministic projection: disable barracks suspects + optional iron buy
        (fixture defaults).
      </p>
      <Button variant="primary" className="approve" onClick={onRun}>
        Simulate 24h
      </Button>
      {result != null && (
        <pre style={{ marginTop: 8 }}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

export function TableView({
  picture,
  onSelect,
  selectedId,
}: {
  picture: FinancePicture;
  onSelect: (id: number) => void;
  selectedId?: number | null;
}) {
  return (
    <div style={{ overflow: "auto" }}>
      <h2>Portfolio table</h2>
      <table className="table-view">
        <thead>
          <tr>
            <th>Province</th>
            <th>Role</th>
            <th>Eff</th>
            <th>Morale</th>
            <th>Asset</th>
            <th>Problem</th>
            <th>Best</th>
          </tr>
        </thead>
        <tbody>
          {picture.provinces.map((p) => (
            <tr
              key={p.id}
              className={p.id === selectedId ? "active" : undefined}
              style={{
                cursor: "pointer",
                background:
                  p.id === selectedId ? "var(--panel2)" : undefined,
              }}
              onClick={() => onSelect(p.id)}
            >
              <td>{p.name}</td>
              <td>{p.role}</td>
              <td className="mono">{p.efficiencyScore}</td>
              <td className="mono">
                {p.morale != null ? Math.round(p.morale) : "—"}
              </td>
              <td className="mono">{p.assetScore}</td>
              <td className="mono">{p.problemScore}</td>
              <td>{p.bestAction?.upgradeName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
