import type {
  ReactNode,
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
} from "react";
import type { StatusTone } from "../theme";

export function Panel({
  title,
  children,
  className = "",
  actions,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({
  children,
  tone = "neutral",
  mono,
  title,
}: {
  children: ReactNode;
  tone?: StatusTone;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`chip chip-${tone}${mono ? " mono" : ""}`}
      title={title}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  tone,
  className = "",
}: {
  value: number;
  max?: number;
  tone?: StatusTone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`bar ${className}`.trim()} role="progressbar" aria-valuenow={pct}>
      <i
        className={tone ? `bar-fill-${tone}` : undefined}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
  size = "md",
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={`seg ${size === "sm" ? "seg-sm" : ""} ${className}`.trim()} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          className={value === opt.id ? "active" : undefined}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  variant = "ghost",
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty muted">{children}</div>;
}

export function ListRow({
  children,
  onClick,
  active,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { active?: boolean }) {
  return (
    <div
      className={`list-item${active ? " active" : ""} ${className}`.trim()}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e as unknown as MouseEvent<HTMLDivElement>);
              }
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </div>
  );
}

export function SeverityDot({ severity }: { severity: string }) {
  const tone =
    severity === "high" || severity === "critical"
      ? "bad"
      : severity === "medium" || severity === "warn"
        ? "warn"
        : "neutral";
  return <span className={`sev-dot sev-${tone}`} aria-hidden />;
}

export function MetricBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <div className="label">{label}</div>
      {children}
    </div>
  );
}
