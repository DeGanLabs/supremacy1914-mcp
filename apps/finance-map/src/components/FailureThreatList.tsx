import type { FinancePicture } from "../types";
import { EmptyState, ListRow, Panel, SeverityDot } from "./ui";

export function FailureThreatList({
  picture,
  onSelectProvince,
  selectedId,
}: {
  picture: FinancePicture;
  onSelectProvince: (id: number) => void;
  selectedId?: number | null;
}) {
  return (
    <>
      <Panel title="Failures">
        {picture.national.failures.length === 0 && (
          <EmptyState>None</EmptyState>
        )}
        {picture.national.failures.slice(0, 12).map((f, i) => {
          const pid = f.provinceIds?.[0];
          return (
            <ListRow
              key={`${f.code}-${i}`}
              active={pid != null && pid === selectedId}
              onClick={
                pid != null ? () => onSelectProvince(pid) : undefined
              }
            >
              <SeverityDot severity={f.severity} />
              {f.line}
            </ListRow>
          );
        })}
      </Panel>
      <Panel title="Threats">
        {picture.national.threats.length === 0 && (
          <EmptyState>None</EmptyState>
        )}
        {picture.national.threats.slice(0, 10).map((t, i) => (
          <ListRow key={`${t.code}-${i}`}>
            <SeverityDot severity="medium" />
            {t.line}
          </ListRow>
        ))}
      </Panel>
    </>
  );
}
