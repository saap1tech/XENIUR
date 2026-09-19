import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PackageInspectionView } from "@xeniur/core";
import { Arrival } from "./Arrival.js";

const noop = vi.fn();
const base: PackageInspectionView = {
  ok: true, problems: [], intent: "share", relationship: "new",
  contents: { objectId: "o", title: "Colour strategy", versions: 3, decisions: 2, sources: 1, atoms: 4, bytes: 1200 },
  discloses: ["1 source you read, with the stored text"],
  publisher: { publicKey: "Q".repeat(43), displayName: "Samir", trust: "unknown", firstSeen: null, proofHistory: 0,
    importsToday: 1, dailyLimit: 3, self: false },
};
const render = (i: PackageInspectionView) =>
  renderToStaticMarkup(<Arrival path="/x/critique.xeniur" inspection={i} onOpen={noop} onBlock={noop} onDismiss={noop} />);

describe("Arrival — a package is here and nothing is written", () => {
  it("names the sender with a glyph and a word, never a colour alone, and shows the daily count", () => {
    const html = render(base);
    expect(html).toContain("Samir");
    expect(html).toContain("○");
    expect(html).toContain("unknown here — you have not judged them");
    expect(html).toContain("1 of 3 today");
    expect(html).toContain("QQQQQQQQ…");
  });

  it("someone else's work opens for review; a critique opens beside your work; Not now is always there", () => {
    expect(render(base)).toContain("Open for review");
    expect(render(base)).toContain("Not now");
    expect(render(base)).toContain("Block Samir");
    const critique = render({ ...base, intent: "critique" });
    expect(critique).toContain("Open beside my work");
    expect(critique).toContain("Nothing of yours changes");
    expect(critique).not.toContain("Open for review");
  });

  it("a refused package shows its reasons and says nothing was written", () => {
    const html = render({ ...base, ok: false, publisher: null,
      problems: ["this package is not signed; XENIUR does not open packages nobody vouches for"] });
    expect(html).toContain("Nobody vouches for this");
    expect(html).toContain("not signed");
    expect(html).toContain("Nothing was written");
    expect(html).not.toContain("Open for review");
    expect(html).not.toContain("Open beside");
  });

  it("a blocked sender is shown as blocked and cannot be blocked again", () => {
    const html = render({ ...base, ok: false, problems: ["you have blocked \"Samir\""],
      publisher: { ...base.publisher!, trust: "blocked" } });
    expect(html).toContain("blocked by you");
    expect(html).not.toContain("Block Samir");
  });
});
