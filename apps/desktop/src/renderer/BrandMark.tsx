const logoUrl = new URL("../../../../brand/XR_logo_vector.svg", import.meta.url).href;

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`xr-brand${compact ? " xr-brand--compact" : ""}`} aria-label="XENIUR">
      <img src={logoUrl} alt="" aria-hidden="true" />
      {!compact && <strong>XENIUR</strong>}
    </span>
  );
}
