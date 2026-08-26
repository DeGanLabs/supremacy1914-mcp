import type { FinancePicture } from "../types";
import { ListRow, Panel } from "./ui";

function RankingBlock({
  title,
  rows,
  selectedId,
  onSelectProvince,
  renderNote,
}: {
  title: string;
  rows: {
    provinceId: number;
    provinceName: string;
    score: number;
    note?: string;
  }[];
  selectedId?: number | null;
  onSelectProvince: (id: number) => void;
  renderNote?: boolean;
}) {
  return (
    <>
      <h3>{title}</h3>
      {rows.map((row, i) => (
        <ListRow
          key={`${title}-${row.provinceId}-${i}`}
          active={row.provinceId === selectedId}
          onClick={() => onSelectProvince(row.provinceId)}
        >
          {i + 1}. {renderNote && row.note ? `${row.note} @ ` : ""}
          {row.provinceName}{" "}
          <span className="mono">{row.score}</span>
        </ListRow>
      ))}
    </>
  );
}

export function RankingsPanel({
  picture,
  onSelectProvince,
  selectedId,
}: {
  picture: FinancePicture;
  onSelectProvince: (id: number) => void;
  selectedId?: number | null;
}) {
  const r = picture.national.rankings;
  return (
    <Panel title="Rankings">
      <RankingBlock
        title="Top assets"
        rows={r.topAssets}
        selectedId={selectedId}
        onSelectProvince={onSelectProvince}
      />
      <RankingBlock
        title="Top problems"
        rows={r.topProblems}
        selectedId={selectedId}
        onSelectProvince={onSelectProvince}
      />
      <RankingBlock
        title="Best investments"
        rows={r.bestInvestments}
        selectedId={selectedId}
        onSelectProvince={onSelectProvince}
        renderNote
      />
    </Panel>
  );
}
