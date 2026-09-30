import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AvailabilityReport } from "@xeniur/core";
import { Models } from "./Models.js";
import { KEY_MAP, KeyboardMap } from "./KeyboardMap.js";
import { Availability } from "./Availability.js";

const noop = () => {};

describe("model setup", () => {
  it("appears before work when no model is ready and keeps local work available", () => {
    (globalThis as { window?: unknown }).window = { xeniur: { models: { list: async () => [], budget: async () => ({ perActionUsdMax: 1, monthlyUsdMax: 100, monthlySpentUsd: 0 }) } } };
    try {
      const html = renderToStaticMarkup(<Models firstRun reason="This task can use cloud AI." onBack={noop} />);
      expect(html).toContain("This task can use cloud AI.");
      expect(html).toContain("OpenRouter API key");
      expect((html.match(/type="password"/g)??[])).toHaveLength(1);
      for(const legacy of ["Meshy", "Runway", "OpenAI API key", "Gemini API key"])expect(html).not.toContain(legacy);
      expect(html).toContain("Use without AI");
      expect(html).toContain("Key encrypted on this computer.");
    } finally { delete (globalThis as { window?: unknown }).window; }
  });
});

describe("the keyboard map", () => {
  it("lists the World shortcuts in words", () => {
    const html = renderToStaticMarkup(<KeyboardMap onClose={noop} />);
    for (const key of ["⌘", "K", "P", "W", "Esc", "?", "1 – 4", "Enter"]) expect(html).toContain(`<kbd>${key}</kbd>`);
    expect(KEY_MAP.map((row) => row.what)).toContain("keys.density");
  });
});

describe("What works here", () => {
  it("shows separate availability states", () => {
    const features = {
      "brain.live": { state: "disabled_by_policy", because: "requires a selected model" },
      "models.cloud": { state: "needs_setup", because: "no cloud key is stored" },
      "browser.manual": { state: "available", because: "isolated tabs" },
      "browser.delegated": { state: "not_implemented", because: "no driver acts on a visible tab yet" },
    };
    const report: AvailabilityReport = { at: 1_700_000_000_000, features: {
      ...Object.fromEntries(["browser.route.service_api", "outreach.send", "web.risk_lookup", "hands.playwright", "capabilities.registry"].map((id) => [id, { state: "not_implemented", because: "not ready" }])),
      ...features,
    } as AvailabilityReport["features"] };
    const html = renderToStaticMarkup(<Availability report={report} onBack={noop} onModels={noop} />);
    for (const word of ["available", "needs setup", "disabled by policy", "not implemented"]) expect(html).toContain(`>${word}<`);
    expect(html).toContain("Nothing on this list is a promise.");
  });
});
