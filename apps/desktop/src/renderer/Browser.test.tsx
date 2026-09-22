import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IMPLEMENTATION_WORDS, stripTechnical } from "@xeniur/ui";
import { Browser } from "./Browser.js";

/**
 * The browser surface: tabs, the person's accounts, back/forward/reload, find, downloads held.
 * No control here confirms anything: an action appears only as its own reviewed plan.
 */
const noop = () => {};
const bridge = (over: Record<string, unknown> = {}) => {
  (globalThis as { window?: unknown }).window = {
    xeniur: { browser: {
      profiles: async () => [{ id: "p1", label: "Work", kind: "signed_in", partition: "persist:web:profile:p1", createdAt: 1, lastUsedAt: null }],
      tabs: async () => [], downloads: async () => [], onEvent: () => () => {}, setBounds: noop, state: async () => null, ...over,
    } },
    addEventListener: noop, removeEventListener: noop,
  };
};
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe("the browser surface", () => {
  it("offers tabs, accounts, navigation and find — and confirms nothing", () => {
    bridge();
    const html = renderToStaticMarkup(<Browser worldId="11111111-1111-4111-8111-111111111111" onBack={noop} onSave={noop} />);
    expect(html).toContain("xr-web-browser__tabs");
    expect(html).toContain("Your accounts");
    for (const label of ["Back", "Forward", "Reload", "Find on this page"]) expect(html).toContain(label);
    expect(html).toContain("You are browsing");
    expect(html).not.toMatch(/>Confirm|>Approve|>Send</);
    expect(html).toContain("downloads held, never taken");
  });

  it("says what a project tab is for, and unassigned browsing saves nothing", () => {
    bridge();
    const inProject = renderToStaticMarkup(<Browser worldId="11111111-1111-4111-8111-111111111111" onBack={noop} onSave={noop} />);
    expect(inProject).toContain("Save to project");
    const unassigned = renderToStaticMarkup(<Browser worldId={null} onBack={noop} onSave={noop} />);
    expect(unassigned).not.toContain("Save to project");
    // Nothing is saveable until a tab is open: the control is there and refuses.
    expect(inProject).toMatch(/<button[^>]*disabled[^>]*>Save to project<\/button>/);
  });

  it("says none of the implementation's nouns", () => {
    bridge();
    const html = stripTechnical(renderToStaticMarkup(<Browser worldId={null} onBack={noop} />));
    const hit = html.match(IMPLEMENTATION_WORDS);
    expect(hit, hit ? html.slice(Math.max(0, hit.index! - 60), hit.index! + 30) : "").toBeNull();
  });
});
