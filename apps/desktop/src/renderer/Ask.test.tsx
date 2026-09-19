import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AskResult } from "./Ask.js";

describe("Ask shows what happened, never what did not", () => {
  it("a gated call shows the reason and no output", () => {
    const html = renderToStaticMarkup(<AskResult result={{
      status: "gated", reason: "The Brain is built and tested but switched off. No request has been made, and XENIUR is not holding a key.",
      proposed: null, trail: null,
    }} />);
    expect(html).toContain("Not sent.");
    expect(html).toContain("switched off");
    expect(html).not.toMatch(/proposed|claim|step/i);
  });

  it("a proposal names counts and says none of it is knowledge yet", () => {
    const html = renderToStaticMarkup(<AskResult result={{ status: "ok", reason: null, proposed: { claims: 5, steps: 9, unsupported: 1 }, trail: null }} />);
    expect(html).toContain("5 claims and 9 steps proposed; 1 unsupported by the sources given");
    expect(html).toContain("none is knowledge yet");
  });
});
