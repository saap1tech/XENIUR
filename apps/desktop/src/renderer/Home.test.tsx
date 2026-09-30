import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Today, TodayRow, TrustFacts } from "@xeniur/core";
import { Home } from "./Home.js";

const noop = vi.fn();
const world = { id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027", emoji: "R", summary: "Research to delivery",
  createdAt: 1, lastOpenedAt: null, kind: "work" as const, publisherId: null };
const row = (i: number, kind: TodayRow["kind"] = "parked_approval"): TodayRow => ({
  id: `task:${i}`, kind, glyph: "▲", text: `approval ${i}`, worldId: world.id, worldTitle: world.title, objectId: null, zone: "work", verb: "Look at it",
});
const home = (today: Today | null, trust: Record<string, TrustFacts> = {}) => renderToStaticMarkup(<Home
  worlds={[world]} active={[]} info={null} economy={null} today={today} trust={trust}
  onOpen={noop} onOpenSituation={noop} onContinue={noop} onStart={noop} onCreate={noop} onReject={noop}
  onDismissArrival={noop} onExplore={noop} onWorkflows={noop} onModels={noop} />);

describe("Home", () => {
  it("gives the last project a clear return path and keeps model settings available", () => {
    const html = home({ date: "d", quiet: true, more: 0, rows: [], resume: {
      worldId: world.id, worldTitle: world.title, goalId: null, focusObjectId: null, lastActiveAt: 1, position: null,
      fragments: [{ text: "You were weighing ", objectId: null }, { text: "Jacket shell", objectId: world.id }],
    } });
    expect(html.replace(/<[^>]*>/g, " ")).toMatch(/Your next\s+move\./);
    expect(html).toContain("Continue project");
    expect(html).toContain("xr-haven__resume-link");
    expect(html).toContain("Settings");
    expect(html.indexOf("xr-haven__hero")).toBeLessThan(html.indexOf("xr-haven__now"));
    expect(html.indexOf("xr-haven__now")).toBeLessThan(html.indexOf("xr-haven__projects"));
  });

  it("shows three urgent situations first and leaves approval inside the project", () => {
    const html = home({ date: "d", quiet: false, more: 2, resume: null, rows: Array.from({ length: 7 }, (_, i) => row(i)) });
    expect((html.match(/class="xr-haven__situation"/g) ?? []).length).toBe(3);
    expect(html).toContain("See 4 more");
    expect(html).toContain("2 more in your projects");
    expect(html).toContain("Review");
    expect(html).toContain("Decline");
    expect(html).not.toMatch(/>Approve/);
  });

  it("makes a quiet day feel complete and offers two visual starting points", () => {
    const html = home({ date: "d", quiet: true, more: 0, resume: null, rows: [] });
    expect(html).toContain("All clear");
    expect(html).toContain("Start something");
    expect(html).toContain("Add material");
    expect(html).not.toContain("<textarea");
  });

  it("shows a challenge decline and settled project state without a dense trust strip", () => {
    const facts: TrustFacts = { objectId: world.id, support: { supported: 12, ambiguous: 0, unresolved: 0, contradicted: 0 },
      evidence: { current: 6, total: 6 }, provenance: { human: 4, tool: 6, model: 2 }, actions: { receipted: 3, unknown: 0 },
      cost: { usd: .04, escalations: 2 }, decisionsNeedingReview: 0, settled: true };
    const html = home({ date: "d", quiet: false, more: 0, resume: null, rows: [{ ...row(1, "challenge_arrival"), id: "arrival:x", verb: "Look" }] }, { [world.id]: facts });
    expect(html).toContain("Not for me");
    expect(html).toContain("xr-haven__project-bottom");
    expect(html).not.toContain("xr-folder__trust");
  });

  it("does not offer direct approval from Home", () => {
    expect(readFileSync(join(__dirname, "Home.tsx"), "utf8")).not.toContain("onApprove");
  });
});
