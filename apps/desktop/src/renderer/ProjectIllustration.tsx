const workshop = new URL("../../../../brand/illustrations/workshop-path.png", import.meta.url).href;
const sharpen = new URL("../../../../brand/illustrations/sharpen-basis.png", import.meta.url).href;
const source = new URL("../../../../brand/illustrations/source-garden.png", import.meta.url).href;
const browser = new URL("../../../../brand/illustrations/open-horizon.png", import.meta.url).href;
const finish = new URL("../../../../brand/illustrations/made-with-care.png", import.meta.url).href;
const research = new URL("../../../../brand/illustrations/research-path.png", import.meta.url).href;

/** A quiet image belongs at an entry or a pause, never behind editable work. */
export function ProjectIllustration({ kind = "workshop", className = "" }: { kind?: "workshop" | "sharpen" | "research" | "source" | "browser" | "finish"; className?: string }) {
  return <img className={`xr-illustration ${className}`} src={kind === "sharpen" ? sharpen : kind === "research" ? research : kind === "source" ? source : kind === "browser" ? browser : kind === "finish" ? finish : workshop} alt="" aria-hidden="true" loading="lazy" decoding="async" />;
}
