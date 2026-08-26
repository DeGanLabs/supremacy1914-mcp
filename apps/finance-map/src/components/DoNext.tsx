import { useState } from "react";
import type { FinanceActionCandidate, FinancePicture } from "../types";
import { approveBuild } from "../api";
import { Button, EmptyState, Panel } from "./ui";

function canApprove(c: FinanceActionCandidate): boolean {
  if (c.action !== "constructBuilding" || c.upgradeId == null) return false;
  if (!c.affordable) return false;
  return c.blockedBy.filter((b) => b !== "none").length === 0;
}

export function DoNext({
  picture,
  onSelectProvince,
  onApproved,
  compact = false,
}: {
  picture: FinancePicture;
  onSelectProvince: (id: number) => void;
  onApproved?: (picture?: FinancePicture) => void;
  compact?: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = picture.national.doNext.slice(0, compact ? 4 : 8);

  return (
    <Panel
      title="Do next / Capital allocation"
      className={compact ? "do-next-panel is-compact" : "do-next-panel"}
    >
      <div className="do-next">
        {rows.map((c, i) => {
          const blocked = c.blockedBy.filter((b) => b !== "none").length > 0;
          const key = `${c.provinceId}-${c.upgradeId}-${i}`;
          const ok = canApprove(c);
          return (
            <div key={key} className="do-row">
              <div
                style={{ cursor: "pointer" }}
                onClick={() => onSelectProvince(c.provinceId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectProvince(c.provinceId);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <strong>
                  {i + 1}. {c.upgradeName ?? c.action}
                </strong>{" "}
                @ {c.provinceName}
                <div className="muted mono">
                  ${c.cost}
                  {c.paybackHours != null
                    ? ` · payback ${c.paybackHours}h`
                    : ""}
                  {c.netBenefitPerHour != null
                    ? ` · +${c.netBenefitPerHour}/h est`
                    : ""}{" "}
                  · prio {c.priority}
                  {!c.affordable
                    ? " · need resources"
                    : blocked
                      ? ` · blocked: ${c.blockedBy
                          .filter((b) => b !== "none")
                          .join(",")}`
                      : ""}
                </div>
              </div>
              <span className="mono muted">{c.confidence}</span>
              <Button
                variant="primary"
                className="approve"
                disabled={!ok || busyId === key}
                title={
                  !c.affordable
                    ? "Not enough resources"
                    : blocked
                      ? `Blocked: ${c.blockedBy.filter((b) => b !== "none").join(", ")}`
                      : "Build now"
                }
                onClick={async () => {
                  if (c.upgradeId == null || !ok) return;
                  setBusyId(key);
                  const res = await approveBuild(c.provinceName, c.upgradeId);
                  setBusyId(null);
                  if (!res.ok) {
                    alert(res.error ?? "Build failed");
                    return;
                  }
                  onApproved?.(res.picture);
                }}
              >
                {busyId === key ? "…" : "Approve"}
              </Button>
            </div>
          );
        })}
        {picture.national.doNext.length === 0 && (
          <EmptyState>No candidates — connect bridge + refresh</EmptyState>
        )}
      </div>
    </Panel>
  );
}
