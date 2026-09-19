import type { ReactNode } from "react";
import type { Provenance } from "@xeniur/core";

export function Panel({ title, actions, children }: {
  title?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="xr-panel">
      {(title || actions) && (
        <header className="xr-panel__head">
          {title && <h2 className="xr-panel__title">{title}</h2>}
          {actions && <div className="xr-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="xr-panel__body">{children}</div>
    </section>
  );
}

/**
 * Provenance is shown, always. A person should never have to wonder whether what they
 * are looking at came from a model, from a deterministic tool, or from a stub standing
 * in for one — so "mock" is rendered as loudly as anything else.
 */
export function ProvenanceBadge({ provenance, provider }: { provenance: Provenance; provider?: string | null }) {
  const label: Record<Provenance, string> = {
    generated: "generated", deterministic: "computed", imported: "imported",
    human: "yours", mock: "MOCK",
  };
  return (
    <span className={`xr-badge xr-badge--${provenance}`} title={provider ?? provenance}>
      {label[provenance]}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="xr-empty">{children}</p>;
}

export function Button({ onClick, variant = "default", children, disabled = false, type = "button" }: {
  onClick?: () => void; variant?: "default" | "primary" | "danger"; children: ReactNode;
  disabled?: boolean;
  /** "submit" for the one button in a form that should submit it. */
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`xr-button xr-button--${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
