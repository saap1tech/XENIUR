import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Home } from "./Home.js";

const noop = vi.fn();

describe("Home visual hierarchy", () => {
  it("leads with Worlds and active situations without turning language into a prompt hero", () => {
    const html = renderToStaticMarkup(<Home
      today={null} trust={{}} onOpenSituation={noop} onContinue={noop} onStart={noop} onDismissArrival={noop}
      worlds={[{
        id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027",
        emoji: "R", summary: "Research to delivery", createdAt: 1, lastOpenedAt: null, kind: "work", publisherId: null,
      }]}
      active={[]}
      info={null}
      economy={null}
      onOpen={noop}
      onCreate={noop}
      onReject={noop}
      onExplore={noop}
      onWorkflows={noop}
    />);

    expect(html).toContain("Pick up where you left off.");
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
  onOpen={noop} onOpenSituation={noop} onContinue={noop} onStart={noop} onCreate={noop} onReject={noop} onDismissArrival={noop} onExplore={noop} onWorkflows={noop} />);

describe("Today", () => {
  it("shows at most seven rows and counts the rest", () => {
    const today: Today = { date: "2026-09-16", quiet: false, more: 3, resume: null, rows: Array.from({ length: 7 }, (_, i) => row(i)) };
    const html = home(today);
    expect((html.match(/xr-today__row /g) ?? []).length).toBe(7);
    expect(html).toContain("3 more behind these");
  });

  it("never shows a running or finished task, even when the task list has one", () => {
    expect(home({ date: "2026-09-16", quiet: true, more: 0, resume: null, rows: [] })).not.toContain("rendering the turntable");
  });

  it("is calm when nothing needs you — a valid state, not an empty one", () => {
    const html = home({ date: "2026-09-16", quiet: true, more: 0, resume: null, rows: [] });
    expect(html).toContain("Nothing needs you.");
    expect(html).not.toContain("xr-today__row ");
  });

  it("carries a glyph and a word on every row, and a challenge arrival can be declined", () => {
    const today: Today = { date: "2026-09-16", quiet: false, more: 0, resume: null, rows: [
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
    const settled = home({ date: "d", quiet: true, more: 0, resume: null, rows: [] }, { [world.id]: facts });
    expect(settled).toContain("xr-folder__trust is-settled");
    expect(settled).toContain("● 12");
    expect(settled).toContain("6/6 current");
    expect(settled).toContain("settled");
    const unsettled = home({ date: "d", quiet: true, more: 0, resume: null, rows: [] }, { [world.id]: { ...facts, support: { ...facts.support, unresolved: 1 }, settled: false } });
    expect(unsettled).not.toContain("is-settled");
    expect(unsettled).toContain("○ 1");
  });
});

describe("Continue Work", () => {
  it("leads with the last active World and a sentence built from fragments, each a link", () => {
    const html = home({ date: "d", quiet: true, more: 0, rows: [], resume: {
      worldId: world.id, worldTitle: "Rainwear 2027", goalId: "g", focusObjectId: "o", lastActiveAt: 1,
      fragments: [{ text: "You were weighing ", objectId: null }, { text: "\"Jacket shell\"", objectId: "o" }, { text: ".", objectId: null },
        { text: " One new source was added.", objectId: null }],
    } });
    expect(html.indexOf("Pick up where you left off")).toBeLessThan(html.indexOf("Your Worlds"));
    expect(html).toContain("Last active World");
    expect(html).toContain("Continue this work");
    expect(html).toContain("xr-resume__link");
    expect(html).toContain("One new source was added.");
  });

  it("offers Start something and Bring something in, and asks for the goal in words", () => {
    const html = home({ date: "d", quiet: true, more: 0, rows: [], resume: null });
    expect(html).toContain("Start something");
    expect(html).toContain("Bring something in");
    expect(html).toContain("Nothing to pick up yet");
    expect(html).not.toMatch(/profession|researcher|designer/i);
  });
});

/* M6 Part C, Gate 0 — Review is not approval. */
describe("Review is not approval", () => {
  it("a parked task's Review opens its situation; nothing on Home approves", () => {
    const html = home({ date: "2026-09-21", quiet: false, more: 0, resume: null, rows: [row(1)] });
    expect(html).toContain(">Review<");
    expect(html).toContain(">Decline<");
    expect(html).not.toMatch(/>Approve/);
  });

  it("Home has no approval callback at all", () => {
    const src = readFileSync(join(__dirname, "Home.tsx"), "utf8");
    expect(src).not.toContain("onApprove");
  });
});
