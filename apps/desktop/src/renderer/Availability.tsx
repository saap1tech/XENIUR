import { useEffect, useState } from "react";
import type { AvailabilityReport, Feature } from "@xeniur/core";
import { AVAILABILITY_WORDS, FEATURES, FEATURE_WORDS } from "@xeniur/core";
import { t } from "@xeniur/ui";
import { BrandMark } from "./BrandMark.js";

/**
 * What works here — read from the assembled runtime when the screen opens, never remembered.
 * Four words per feature, each with the reason. A feature that is named but built nowhere says
 * so; one held off by a switch says that the switch is not on this screen.
 */
export function Availability({ report: given, onBack, onModels }: { report?: AvailabilityReport | null; onBack(): void; onModels(): void }) {
  const bridge = typeof window === "undefined" ? undefined : window.xeniur;
  const [report, setReport] = useState<AvailabilityReport | null>(given ?? null);
  useEffect(() => { if (!given) void bridge?.system?.availability?.().then((r) => setReport(r ?? null)); }, [bridge, given]);

  return (
    <main className="xr-avail">
      <header className="xr-avail__head">
        <button type="button" className="xr-back" onClick={onBack}>← {t("models.back")}</button>
        <BrandMark compact />
        <h1>{t("avail.title")}</h1>
        <p>{t("avail.lead")}</p>
      </header>
      {report === null ? <p className="xr-avail__quiet">{t("avail.reading")}</p> : (
        <ul className="xr-avail__list">
          {FEATURES.map((f: Feature) => {
            const a = report.features[f];
            const w = AVAILABILITY_WORDS[a.state];
            return (
              <li key={f} className={`xr-avail__row is-${a.state}`}>
                <span className="xr-avail__feature">{FEATURE_WORDS[f]}</span>
                <span className="xr-avail__state" title={w.means}>{w.label}</span>
                <span className="xr-avail__because">{a.because}</span>
                {f === "models.cloud" && a.state === "needs_setup" && <button type="button" className="xr-text-action" onClick={onModels}>{t("models.title")}</button>}
              </li>
            );
          })}
        </ul>
      )}
      <footer className="xr-avail__foot">
        <small className="xr-mono">{report ? new Date(report.at).toISOString().replace("T", " ").slice(0, 19) : ""}</small>
        <p>{t("avail.foot")}</p>
      </footer>
    </main>
  );
}
