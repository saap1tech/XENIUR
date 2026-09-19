import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Home } from "./Home.js";

const noop = vi.fn();

describe("Home visual hierarchy", () => {
  it("leads with Worlds and active situations without turning language into a prompt hero", () => {
    const html = renderToStaticMarkup(<Home
      today={null} trust={{}} onOpenSituation={noop} onDismissArrival={noop}
      worlds={[{
        id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027",
        emoji: "R", summary: "Research to delivery", createdAt: 1, lastOpenedAt: null, kind: "work", publisherId: null,
      }]}
      active={[]}
      info={null}
      economy={null}
      onOpen={noop}
      onCreate={noop}
      onApprove={noop}
      onReject={noop}
      onExplore={noop}
      onWorkflows={noop}
    />);

    expect(html).toContain("Work in view.");
    expect(html).toContain("Your Worlds");
    expect(html).toContain("Today");
    expect(html).toContain("Language is available inside each World as a shortcut.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toMatch(/placeholder=/);
    expect(html.indexOf("Your Worlds")).toBeLessThan(html.indexOf("Language is available"));
  });
});

/* The UI layer — Today: at most seven situations, never a feed. */
import type { Today, TodayRow, TrustFacts } from "@xeniur/core";

const world = { id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027", emoji: "R", summary: "Research to delivery",
  createdAt: 1, lastOpenedAt: null, kind: "work" as const, publisherId: null };
const row = (i: number, kind: TodayRow["kind"] = "parked_approval"): TodayRow => ({
  id: `task:${i}`, kind, glyph: "▲", text: `approval ${i}`, worldId: world.id, worldTitle: world.title, objectId: null, zone: "work", verb: "Look at it",
});
const home = (today: Today | null, trust: Record<string, TrustFacts> = {}) => renderToStaticMarkup(<Home
  worlds={[world]} active={[{ id: "t-running", worldId: world.id, title: "rendering the turntable", status: "running", tool: "3d.render",
    payload: {}, progress: .4, attempts: 1, detail: null, error: null, createdAt: 1, updatedAt: 1, startedAt: 1, finishedAt: null } as never]}
  info={null} economy={null} today={today} trust={trust}
  onOpen={noop} onOpenSituation={noop} onCreate={noop} onApprove={noop} onReject={noop} onDismissArrival={noop} onExplore={noop} onWorkflows={noop} />);

describe("Today", () => {
  it("shows at most seven rows and counts the rest", () => {
    const today: Today = { date: "2026-09-16", quiet: false, more: 3, rows: Array.from({ length: 7 }, (_, i) => row(i)) };
    const html = home(today);
    expect((html.match(/xr-today__row /g) ?? []).length).toBe(7);
    expect(html).toContain("3 more behind these");
  });

  it("never shows a running or finished task, even when the task list has one", () => {
    expect(home({ date: "2026-09-16", quiet: true, more: 0, rows: [] })).not.toContain("rendering the turntable");
  });

  it("is calm when nothing needs you — a valid state, not an empty one", () => {
    const html = home({ date: "2026-09-16", quiet: true, more: 0, rows: [] });
    expect(html).toContain("Nothing needs you.");
    expect(html).not.toContain("xr-today__row ");
  });

  it("carries a glyph and a word on every row, and a challenge arrival can be declined", () => {
    const today: Today = { date: "2026-09-16", quiet: false, more: 0, rows: [
      row(1), { ...row(2, "challenge_arrival"), id: "arrival:x", glyph: "◷", text: "A challenge matching your work opened — 7 days · no generative geometry", verb: "Look" },
    ] };
    const html = home(today);
    expect(html).toContain("▲");
    expect(html).toContain("◷");
    expect(html).toContain("no generative geometry");
    expect(html).toContain("Not for me");
    expect(html).toContain("Nothing else needs you.");
  });

  it("a World folder carries its Trust Strip, lime only when settled", () => {
    const facts: TrustFacts = { objectId: world.id, support: { supported: 12, ambiguous: 2, unresolved: 0, contradicted: 0 },
      evidence: { current: 6, total: 6 }, provenance: { human: 4, tool: 6, model: 2 }, actions: { receipted: 3, unknown: 0 },
      cost: { usd: 0.04, escalations: 2 }, decisionsNeedingReview: 0, settled: true };
    const settled = home({ date: "d", quiet: true, more: 0, rows: [] }, { [world.id]: facts });
    expect(settled).toContain("xr-folder__trust is-settled");
    expect(settled).toContain("● 12");
    expect(settled).toContain("6/6 current");
    expect(settled).toContain("settled");
    const unsettled = home({ date: "d", quiet: true, more: 0, rows: [] }, { [world.id]: { ...facts, support: { ...facts.support, unresolved: 1 }, settled: false } });
    expect(unsettled).not.toContain("is-settled");
    expect(unsettled).toContain("○ 1");
  });
});
