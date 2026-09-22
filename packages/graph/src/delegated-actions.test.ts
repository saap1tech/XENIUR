import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTEMPT_WORDS, GrantRefused, type ActionRequest } from "@xeniur/core";
import { MockRouteAdapter, ObjectGraph, digestOf } from "./index.js";

/**
 * A click is not a success. Every outcome is one of four honest states, attempts are
 * immutable, an uncertain attempt is answered by a check rather than a retry, and the
 * receipt says what the destination established — never more.
 */
const HOUR = 3_600_000;
let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-delegated-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Cold-weather shell", emoji: "◒" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const request: ActionRequest = {
  route: "service_api", actionClass: "api_post", tabId: null, elementRef: null, endpointId: "receiver",
  fields: { order: "120 m taped tape", note: "for the cold-weather range" }, items: [], amount: null, currency: null,
};

async function approved(adapter = new MockRouteAdapter()) {
  g.delegated.register(adapter);
  const draft = await g.delegated.draft({ worldId, adapterId: adapter.id, request });
  const grant = g.grants.issue({
    kind: "action", route: "service_api", worldId, actionClasses: ["api_post"], reviewDigest: draft.reviewDigest,
    oneUse: true, expiresAt: Date.now() + HOUR, because: "send the order you reviewed",
  });
  g.delegated.approve(draft.id, grant.id);
  return { adapter, draft, grant };
}

describe("a delegated action is drafted, described and approved before anything is sent", () => {
  it("describes field names and sizes, never their values, and digests the exact request", async () => {
    const adapter = new MockRouteAdapter();
    g.delegated.register(adapter);
    const draft = await g.delegated.draft({ worldId, adapterId: adapter.id, request });
    expect(draft.description.fields).toEqual([{ name: "order", chars: request.fields["order"]!.length }, { name: "note", chars: request.fields["note"]!.length }]);
    expect(JSON.stringify(draft.description)).not.toContain("120 m taped tape");
    expect(draft.reviewDigest).toBe(digestOf(adapter.id, request));
    expect(adapter.executed).toHaveLength(0);                       // describing sends nothing
  });

  it("refuses a grant that was approved for a different plan", async () => {
    const adapter = new MockRouteAdapter();
    g.delegated.register(adapter);
    const draft = await g.delegated.draft({ worldId, adapterId: adapter.id, request });
    const other = g.grants.issue({ kind: "action", route: "service_api", worldId, actionClasses: ["api_post"],
      reviewDigest: "b".repeat(64), expiresAt: Date.now() + HOUR, because: "something else" });
    expect(() => g.delegated.approve(draft.id, other.id)).toThrow(/plan changed after you approved it/);
  });

  it("refuses to dispatch what was never approved", async () => {
    const adapter = new MockRouteAdapter();
    g.delegated.register(adapter);
    const draft = await g.delegated.draft({ worldId, adapterId: adapter.id, request });
    await expect(g.delegated.dispatch(draft.id)).rejects.toThrow(GrantRefused);
    expect(adapter.executed).toHaveLength(0);
  });
});

describe("four honest states", () => {
  it("confirmed: the destination's evidence, one attempt, a succeeded receipt", async () => {
    const { draft, adapter } = await approved();
    const attempt = await g.delegated.dispatch(draft.id);
    expect(attempt.state).toBe("confirmed");
    expect(attempt.reference).toBe("ref-1");
    expect(adapter.keys).toEqual([attempt.id]);                     // the idempotency key is the attempt
    expect(g.delegated.attempts(draft.id)).toHaveLength(1);
    const receipts = g.db.prepare(`SELECT outcome FROM action_receipts`).all() as Array<{ outcome: string }>;
    expect(receipts.map((r) => r.outcome)).toEqual(["succeeded"]);
  });

  it("failed: evidence of rejection, and the reason", async () => {
    const { draft } = await approved(new MockRouteAdapter({ execute: { state: "failed", reference: null, responseDigest: null, detail: "the endpoint said the order number is unknown" } }));
    const attempt = await g.delegated.dispatch(draft.id);
    expect(attempt.state).toBe("failed");
    expect(attempt.detail).toMatch(/order number is unknown/);
    expect((g.db.prepare(`SELECT outcome FROM action_receipts`).get() as { outcome: string }).outcome).toBe("failed");
  });

  it("a route that throws is uncertain, never failed — and the receipt says unknown", async () => {
    const { draft } = await approved(new MockRouteAdapter({ execute: () => { throw new Error("the connection closed"); } }));
    const attempt = await g.delegated.dispatch(draft.id);
    expect(attempt.state).toBe("uncertain");
    expect(attempt.detail).toMatch(/connection closed/);
    expect((g.db.prepare(`SELECT outcome FROM action_receipts`).get() as { outcome: string }).outcome).toBe("unknown");
    expect(ATTEMPT_WORDS.uncertain.means).toMatch(/Check the status; do not send it again/);
  });

  it("an uncertain attempt is answered by a check, not a retry; a check that confirms moves it", async () => {
    const adapter = new MockRouteAdapter({ execute: { state: "uncertain", reference: "ref-9", responseDigest: null, detail: "timed out" },
      status: { state: "confirmed", detail: "the endpoint has it as received" } });
    const { draft } = await approved(adapter);
    const attempt = await g.delegated.dispatch(draft.id);
    await expect(g.delegated.dispatch(draft.id)).rejects.toThrow(/check its status before sending again/);
    expect(adapter.executed).toHaveLength(1);                        // nothing was sent twice

    const check = await g.delegated.checkStatus(attempt.id);
    expect(check.result).toBe("confirmed");
    expect(g.delegated.attempt(attempt.id)!.state).toBe("confirmed");
    expect(g.delegated.checksOf(attempt.id)).toHaveLength(1);
    const outcomes = (g.db.prepare(`SELECT outcome FROM action_receipts ORDER BY at`).all() as Array<{ outcome: string }>).map((r) => r.outcome);
    expect(outcomes).toEqual(["unknown", "succeeded"]);              // the history keeps what was known
  });

  it("a check that establishes nothing leaves the attempt uncertain, and is still recorded", async () => {
    const { draft } = await approved(new MockRouteAdapter({ execute: { state: "uncertain", reference: null, responseDigest: null, detail: "no answer" } }));
    const attempt = await g.delegated.dispatch(draft.id);
    const check = await g.delegated.checkStatus(attempt.id);
    expect(check.result).toBe("unsupported");
    expect(g.delegated.attempt(attempt.id)!.state).toBe("uncertain");
    expect(g.delegated.checksOf(attempt.id)).toHaveLength(1);
  });

  it("an interrupted attempt becomes uncertain on the next run, never confirmed or failed", async () => {
    const { draft } = await approved();
    const attempt = await g.delegated.dispatch(draft.id);
    g.db.prepare(`UPDATE action_attempts SET state = 'attempted', ended_at = NULL WHERE id = ?`).run(attempt.id);
    expect(g.delegated.reconcileInterrupted()).toBe(1);
    const after = g.delegated.attempt(attempt.id)!;
    expect(after.state).toBe("uncertain");
    expect(after.detail).toMatch(/closed while this was in flight/);
  });

  it("a one-use grant is spent by its action, and the receipt carries digests, never values or tokens", async () => {
    const { draft, grant } = await approved();
    await g.delegated.dispatch(draft.id);
    expect(g.grants.get(grant.id)!.state).toBe("consumed");
    const receipt = g.db.prepare(`SELECT * FROM action_receipts`).get() as { data_sent: string };
    expect(receipt.data_sent).not.toContain("120 m taped tape");
    expect(receipt.data_sent).toContain("order");
  });
});
