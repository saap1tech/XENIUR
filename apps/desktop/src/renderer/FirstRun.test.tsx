import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { World } from "@xeniur/core";
import { FirstRun } from "./FirstRun.js";
import { KEY_MAP, KeyboardMap } from "./KeyboardMap.js";
import { Models } from "./Models.js";

/**
 * The first run is one question — *What would you like to work on?* — with three ways in, and
 * every one of them works with zero keys. Nobody is asked their profession or their model.
 */
const noop = () => {};
const world = (id: string, title: string): World => ({
  id, title, emoji: "◻", summary: "", createdAt: 1, lastOpenedAt: 1, kind: "work", publisherId: null,
});
const render = (worlds: World[] = []) => renderToStaticMarkup(
  <FirstRun worlds={worlds} onDone={noop} onImport={noop} onStart={noop} onContinue={noop} onImportPackage={noop} onOpenExample={noop} />,
);
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());

describe("first run — what would you like to work on?", () => {
  it("asks one question and offers three ways in, each a real action", () => {
    const html = render();
    expect(html).toContain("What would you like to work on?");
    expect(html).toContain("I already have something to work with");
    expect(html).toContain("I want to start something new");
    expect(html).toContain("I want to continue an existing project");
    expect(buttons(html)).toEqual(expect.arrayContaining(["Bring it in", "Begin", "Open a .xeniur package", "Skip"]));
  });

  it("never asks about a profession, a workflow or a model key", () => {
    const html = render();
    expect(html).not.toMatch(/profession|your role|researcher|designer|workflow/i);
    expect(html).not.toMatch(/Your models|API key|provider/i);
    expect(html).not.toContain("<input");                                  // no form wall
    expect(html).toContain("works without a model key");
  });

  it("lists Worlds already here under Continue, and says so when there are none", () => {
    expect(render()).toContain("No projects on this machine yet.");
    const html = render([world("a", "Water reuse"), world("s", "__settings__")]);
    expect(html).toContain("Water reuse");
    expect(html).not.toContain("No projects on this machine yet.");
  });

  it("hides the settings World from Continue", () => {
    const settings = { ...world("s", "Settings"), summary: "__xeniur_settings__" };
    expect(render([settings])).toContain("No projects on this machine yet.");
  });
});

describe("your models — when a task needs it", () => {
  it("says why it appeared and offers the way back", () => {
    (globalThis as { window?: unknown }).window = { xeniur: { models: { list: async () => [] } } };
    try {
      const html = renderToStaticMarkup(<Models reason="This task can use cloud AI. Connect a key, or continue with local capabilities." onBack={noop} />);
      expect(html).toContain("This task can use cloud AI");
      expect(html).toContain("Your models");
      expect(buttons(html).some((b) => /Back/.test(b))).toBe(true);
      expect(html).not.toContain("Skip for now");                         // not a first-run scene any more
    } finally { delete (globalThis as { window?: unknown }).window; }
  });
});

describe("the keyboard map", () => {
  it("lists every key the World listens for, in words", () => {
    const html = renderToStaticMarkup(<KeyboardMap onClose={noop} />);
    for (const k of ["⌘", "K", "P", "W", "Esc", "?", "1 – 4", "Enter"]) expect(html).toContain(`<kbd>${k}</kbd>`);
    expect(html).toContain("Where do I stand");
    expect(html).toContain('role="dialog"');
    expect(KEY_MAP.map((r) => r.what)).toContain("keys.density");
  });
});

/* Gate 0 — what works here, as the runtime says. */
import { Availability } from "./Availability.js";
import type { AvailabilityReport } from "@xeniur/core";

describe("What works here", () => {
  it("shows four distinct state words and never calls a not-implemented feature available", () => {
    const report: AvailabilityReport = { at: 1_700_000_000_000, features: {
      "brain.live": { state: "disabled_by_policy", because: "liveCallsEnabled is false" },
      "models.cloud": { state: "needs_setup", because: "no cloud key is stored" },
      "browser.manual": { state: "available", because: "isolated tabs" },
      "browser.delegated": { state: "not_implemented", because: "no driver acts on a visible tab yet" },
      "browser.route.service_api": { state: "not_implemented", because: "no adapter" },
      "outreach.send": { state: "disabled_by_policy", because: "DisabledTransport" },
      "web.risk_lookup": { state: "disabled_by_policy", because: "local-only" },
      "hands.playwright": { state: "not_implemented", because: "not imported" },
      "capabilities.registry": { state: "not_implemented", because: "never constructed" },
    } };
    const html = renderToStaticMarkup(<Availability report={report} onBack={noop} onModels={noop} />);
    for (const w of ["available", "needs setup", "disabled by policy", "not implemented"]) expect(html).toContain(`>${w}<`);
    const delegated = html.slice(html.indexOf("The assistant acting in a tab"), html.indexOf("Sending to a service endpoint"));
    expect(delegated).toContain("not implemented");
    expect(delegated).not.toContain(">available<");
    expect(html).toContain("Nothing on this list is a promise.");
  });
});
