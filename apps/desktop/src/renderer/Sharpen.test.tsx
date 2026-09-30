import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SharpenSession, WorkState } from "@xeniur/core";
import { Sharpen, SharpenSessionView } from "./Sharpen.js";

const noop = () => {};
const session: SharpenSession = { id: "session", goalId: "goal", worldId: "world", objectId: "decision", objectVersionId: "v1", title: "Offline architecture", subjectKey: "recall", basisDigest: "digest", fact: "A newer stored source exists.", createdAt: 1_700_000_000_000,
  moves: [{ id: "recall", kind: "recall", prompt: "Why did you choose the local option?", recorded: "Lower latency + offline operation + provider independence.", changes: ["The cloud provider now supports an offline mode."], effects: ["reflect"], answer: null, effect: null, reflectionObjectId: null, answeredAt: null },
    { id: "challenge", kind: "challenge", prompt: "What could change your choice?", recorded: "Current rationale", changes: [], effects: ["reflect", "needs_review", "source"], answer: null, effect: null, reflectionObjectId: null, answeredAt: null }],
};
const view = (s = session) => renderToStaticMarkup(<SharpenSessionView session={s} busy={false} onPause={noop} onOpen={noop} onRestart={noop} onAnswer={async () => {}} />);

describe("the thinking path", () => {
  it("asks for recall before revealing recorded reasons and does not force an answer", () => {
    const html = view();
    expect(html).toContain("Why did you choose");
    expect(html).not.toContain("provider independence");
    expect(html).not.toContain("The cloud provider now");
    expect(html).toContain("Show the recorded basis");
    expect(html).toContain("Pause");
    expect(html).toContain('aria-current="step"');
    expect(html).not.toMatch(/XP|grade:|mastery/i);
  });

  it("shows remembered reason, objective record, actual changes, and linked note after saving", () => {
    const one = { ...session, moves: [{ ...session.moves[0]!, answer: "Lower latency.", effect: "reflect" as const, answeredAt: 1_700_000_000_001, reflectionObjectId: "note" }] };
    const html = view(one);
    for (const word of ["YOU REMEMBERED", "RECORDED BASIS", "WHAT CHANGED", "provider independence", "cloud provider now", "Open saved note", "Return to work"]) expect(html).toContain(word);
  });

  it("offers explicit project effects and prevents access to later unanswered moves", () => {
    const s = { ...session, moves: [{ ...session.moves[0]!, answer: "Lower latency.", effect: "reflect" as const, answeredAt: 1 }, session.moves[1]!] };
    const html = view(s);
    expect(html).toContain("How should this change the work?");
    expect(html).toContain("Find another source");
    expect(html).toContain("Request review");
    expect(view()).toMatch(/disabled=""[^>]*><span>.*?Challenge/s);
  });

  it("starts with a compact optional observation strip", () => {
    const initialState: WorkState = { goalId: "goal", worldId: "world", outcome: "Choose architecture", assessedAt: 1, latestSession: null,
      signals: [{ id: "signal", objectId: "decision", title: "Local service", kind: "unreviewed_basis", fact: "A citation has no human review.", priority: 1, subjectKey: "support", lastCheckedAt: null }] };
    const html = renderToStaticMarkup(<Sharpen goalId="goal" objectId="decision" revision={1} initialState={initialState} onOpen={noop} onSaved={noop} />);
    expect(html).toContain("1 recorded condition to consider");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("A citation has no human review.");
    expect(html).toContain("Sharpen this");
  });
});
