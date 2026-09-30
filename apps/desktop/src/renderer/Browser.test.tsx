import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IMPLEMENTATION_WORDS, stripTechnical } from "@xeniur/ui";
import { Browser } from "./Browser.js";
import { SaveToProject } from "./SaveToProject.js";

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

  it("shows the project and current step beside account browsing", () => {
    bridge();
    const id = "11111111-1111-4111-8111-111111111111";
    const html = renderToStaticMarkup(<Browser worldId={id} goalTitle="Launch a small shop" stepTitle="Compare shipping options"
      worlds={[{ id, title: "Shop launch", emoji: "◒", summary: "", createdAt: 1, lastOpenedAt: 1, kind: "work", publisherId: null }]} layout="beside" onBack={noop} />);
    expect(html).toContain("Shop launch");
    expect(html).toContain("Compare shipping options");
    expect(html).toContain("Keep a source");
    expect(html).toContain("Back to project");
  });

  it("says none of the implementation's nouns", () => {
    bridge();
    const html = stripTechnical(renderToStaticMarkup(<Browser worldId={null} onBack={noop} />));
    const hit = html.match(IMPLEMENTATION_WORDS);
    expect(hit, hit ? html.slice(Math.max(0, hit.index! - 60), hit.index! + 30) : "").toBeNull();
  });
});

/* M6 Part C — saving is the person's act, and it says what it is doing. */
describe("Save to project", () => {
  const snapshot = { tabId: "tab-1", url: "https://supplier.example/spec", title: "Seam specification",
    selectionText: "Taped seams held through two winters.", pageText: "…the full readable page…", at: 1, profileLabel: "Work" };

  it("says where it came from, defaults rights to unknown, and keeps saving apart from accepting", () => {
    bridge();
    const html = renderToStaticMarkup(<SaveToProject snapshot={snapshot} worlds={[{ id: "11111111-1111-4111-8111-111111111111", title: "Cold-weather shell", emoji: "◒", summary: "", createdAt: 1, lastOpenedAt: 1, kind: "work", publisherId: null }]}
      worldId="11111111-1111-4111-8111-111111111111" onSaved={noop} onCancel={noop} />);
    expect(html).toContain("in the session you are signed into as Work");
    expect(html).toContain('<option value="unknown" selected=""');
    expect(html).toContain("being able to read it is not a licence");
    expect(html).toContain("Accepting a claim is a separate act");
    expect(html).toContain("Don’t send this to AI");
    // What the person selected is offered first when there is a selection.
    expect(html).toMatch(/aria-checked="true"[^>]*>What you selected/);
  });
});
