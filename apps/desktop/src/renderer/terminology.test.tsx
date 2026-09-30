import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IMPLEMENTATION_WORDS, stripTechnical } from "@xeniur/ui";
import type { AvailabilityReport, World as WorldRow } from "@xeniur/core";
import { Home } from "./Home.js";
import { Models } from "./Models.js";
import { KeyboardMap } from "./KeyboardMap.js";
import { Availability } from "./Availability.js";

/**
 * The words a screen says are the person's: project, item, suggestion. World, Object and
 * candidate are the implementation's and stay in code, tables, IPC and the technical detail
 * one can open (`.xr-technical`). Every screen that can be rendered without Electron is held
 * to this here; the World is held to it in its own test.
 */
const noop = () => {};
const worlds: WorldRow[] = [{ id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027", emoji: "R", summary: "", createdAt: 1, lastOpenedAt: 1, kind: "work", publisherId: null }];

describe("the implementation's nouns stay out of the words a screen says", () => {
  it("Home", () => {
    const html = renderToStaticMarkup(<Home worlds={worlds} active={[]} info={null} economy={null}
      today={{ date: "2026-09-21", quiet: false, more: 2, resume: { worldId: worlds[0]!.id, worldTitle: "Rainwear 2027", goalId: null, focusObjectId: null, lastActiveAt: 1, position: null, fragments: [{ text: "You were in Rainwear 2027.", objectId: null }] },
        rows: [{ id: "task:1", kind: "parked_approval", glyph: "▲", text: "Delivery 02 parked", worldId: worlds[0]!.id, worldTitle: "Rainwear 2027", objectId: null, zone: "work", verb: "Look at it" }] }}
      trust={{}} onOpen={noop} onOpenSituation={noop} onContinue={noop} onStart={noop} onCreate={noop} onReject={noop} onDismissArrival={noop} onExplore={noop} onWorkflows={noop} />);
    expect(stripTechnical(html)).not.toMatch(IMPLEMENTATION_WORDS);
  });

  it("model setup, the keyboard map, and what works here", () => {
    (globalThis as { window?: unknown }).window = { xeniur: { models: { list: async () => [], budget: async () => ({ perActionUsdMax: 1, monthlyUsdMax: 100, monthlySpentUsd: 0 }) } } };
    const setup = renderToStaticMarkup(<Models firstRun onBack={noop} />);
    delete (globalThis as { window?: unknown }).window;
    expect(stripTechnical(setup)).not.toMatch(IMPLEMENTATION_WORDS);
    expect(stripTechnical(renderToStaticMarkup(<KeyboardMap onClose={noop} />))).not.toMatch(IMPLEMENTATION_WORDS);
    const report: AvailabilityReport = { at: 1, features: Object.fromEntries(["brain.live", "models.cloud", "browser.manual", "browser.delegated", "browser.route.service_api", "outreach.send", "web.risk_lookup", "hands.playwright", "capabilities.registry"].map((f) => [f, { state: "not_implemented", because: "x" }])) as AvailabilityReport["features"] };
    expect(stripTechnical(renderToStaticMarkup(<Availability report={report} onBack={noop} onModels={noop} />))).not.toMatch(IMPLEMENTATION_WORDS);
  });
});
