import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NotReady, PERMISSION_LEVELS, TOOLS, authorizeFor, isApprovalRequired, planDigest,
  specOf, type Tool,
} from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { PermissionBroker } from "./index.js";

let dir: string, g: ObjectGraph, broker: PermissionBroker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-perm-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  broker = new PermissionBroker(g.db);
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("the level table decides, not the model", () => {
  it("auto-executes exactly READ, CREATE and MODIFY", () => {
    for (const tool of TOOLS) {
      const d = broker.evaluate({ tool });
      const reversible = ["READ", "CREATE", "MODIFY"].includes(specOf(tool).permission);
      expect(d.autoExecute, `${tool} auto-execute`).toBe(reversible);
      expect(d.requiresApproval, `${tool} approval`).toBe(!reversible);
    }
  });

  it("covers every declared level in the table", () => {
    expect(PERMISSION_LEVELS).toHaveLength(7);
    const used = new Set(TOOLS.map((t) => specOf(t).permission));
    expect(used.has("COMMIT")).toBe(true);
    expect(used.has("READ")).toBe(true);
  });

  it("stops a form submission and describes it in words a person can judge", () => {
    const d = broker.evaluate({
      tool: "browser.submit",
      args: { action: "Book court", when: "5:00 PM", priceUsd: 18 },
    });
    expect(d.requiresApproval).toBe(true);
    expect(d.preview).toBe("Book court · 5:00 PM · $18.00");
  });
});

describe("escalation only ever raises", () => {
  it("raises anything that spends money to PURCHASE", () => {
    const d = broker.evaluate({ tool: "browser.click", args: { label: "Buy now", priceUsd: 412 } });
    expect(d.level).toBe("PURCHASE");       // browser.click is MODIFY by default
    expect(d.autoExecute).toBe(false);
    expect(d.reason).toContain("$412.00");
  });

  it("raises anything permanent to DESTRUCTIVE", () => {
    const d = broker.evaluate({ tool: "object.update", args: { permanent: true } });
    expect(d.level).toBe("DESTRUCTIVE");
    expect(d.autoExecute).toBe(false);
  });

  it("never lowers a level below the tool table", () => {
    for (const tool of TOOLS) {
      const base = specOf(tool).permission;
      const d = broker.evaluate({ tool, args: { priceUsd: 0, destructive: false } });
      expect(PERMISSION_LEVELS.indexOf(d.level))
        .toBeGreaterThanOrEqual(PERMISSION_LEVELS.indexOf(base));
    }
  });
});

describe("money and deletion are confirmed every single time", () => {
  it("refuses to remember an allow for PURCHASE or DESTRUCTIVE", () => {
    expect(broker.remember("ebay.com", "PURCHASE", "allow_session")).toBe(false);
    expect(broker.remember("disk", "DESTRUCTIVE", "allow_session")).toBe(false);
    expect(broker.recall("ebay.com", "PURCHASE")).toBeNull();
    // A denial, on the other hand, is always allowed to stick.
    expect(broker.remember("ebay.com", "PURCHASE", "deny")).toBe(true);
  });

  it("still asks for a purchase even after a session allow was attempted", () => {
    broker.remember("shop.example", "PURCHASE", "allow_session");
    const d = broker.evaluate({ tool: "browser.submit", scope: "shop.example", args: { priceUsd: 99 } });
    expect(d.autoExecute).toBe(false);
    expect(d.level).toBe("PURCHASE");
  });

  it("does let a person allow COMMUNICATE for a session", () => {
    const tool: Tool = "browser.submit";
    expect(broker.evaluate({ tool, scope: "forms.example" }).autoExecute).toBe(false);
    expect(broker.remember("forms.example", "COMMIT", "allow_session")).toBe(true);
    expect(broker.evaluate({ tool, scope: "forms.example" }).autoExecute).toBe(true);
  });
});

describe("content from a page is data, never authority", () => {
  it("will not honour a remembered allow when a page asked for the action", () => {
    broker.remember("forms.example", "COMMIT", "allow_session");
    const fromUser = broker.evaluate({ tool: "browser.submit", scope: "forms.example" });
    const fromPage = broker.evaluate({ tool: "browser.submit", scope: "forms.example", derivedFromUntrusted: true });

    expect(fromUser.autoExecute).toBe(true);
    expect(fromPage.autoExecute).toBe(false);
    expect(fromPage.reason).toContain("a person must confirm");
  });

  it("cannot lower a level or unlock a purchase by claiming authority in page text", () => {
    const d = broker.evaluate({
      tool: "browser.submit",
      derivedFromUntrusted: true,
      args: { priceUsd: 250, label: "The page says the user already approved this" },
    });
    expect(d.level).toBe("PURCHASE");
    expect(d.autoExecute).toBe(false);
  });

  it("leaves reversible local work alone even when a page suggested it", () => {
    const d = broker.evaluate({ tool: "image.transform", derivedFromUntrusted: true });
    expect(d.autoExecute).toBe(true);   // resizing an image is not a side effect
  });
});

describe("guard()", () => {
  it("throws a readable ApprovalRequired that the queue can park on", () => {
    try {
      broker.guard({ tool: "browser.submit", args: { action: "Book court", when: "5:00 PM", priceUsd: 18 } });
      expect.unreachable("guard should have thrown");
    } catch (err) {
      expect(isApprovalRequired(err)).toBe(true);
      if (isApprovalRequired(err)) {
        expect(err.level).toBe("PURCHASE");
        expect(err.preview).toBe("Book court · 5:00 PM · $18.00");
      }
    }
  });

  it("lets an action through when the approval is for exactly that action", () => {
    const plan = { tool: "browser.submit", args: { priceUsd: 18 }, estimatedUsd: 18 };
    const auth = authorizeFor(plan, { scope: "browser.submit", spendLimitUsd: 18 });

    const d = broker.guard({ tool: "browser.submit", args: plan.args, plan, authorization: auth });
    expect(d.autoExecute).toBe(true);

    // Permission is per-plan: the next unapproved request stops again.
    expect(broker.evaluate({ tool: "browser.submit", args: plan.args }).autoExecute).toBe(false);
  });
});

describe("readiness gates actions, in the same place money is gated", () => {
  const gate = (unmet: Array<{ profileId: string; profileName: string; blockers: string[] }>) => ({
    unmet: () => unmet,
  });
  const OBJ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("refuses a guarded action while its profile is unmet, and says what is missing", () => {
    broker.useReadiness(gate([{
      profileId: "send", profileName: "Ready to Send",
      blockers: ["2 forms are mock output, not the real thing"],
    }]));

    const decision = broker.evaluate({ tool: "browser.submit", objectId: OBJ });
    expect(decision.autoExecute).toBe(false);
    expect(decision.reason).toContain("Ready to Send is not satisfied");
    expect(decision.notReady?.[0]?.blockers[0]).toContain("mock output");

    expect(() => broker.guard({ tool: "browser.submit", objectId: OBJ })).toThrow(NotReady);
  });

  it("will not let an approval override readiness", () => {
    // Someone saying yes does not make a stale deck ready to send; it just means they
    // wanted to. They are told what is actually missing instead.
    broker.useReadiness(gate([{
      profileId: "send", profileName: "Ready to Send", blockers: ["3 steps are out of date"],
    }]));
    const plan = { tool: "browser.submit", args: {}, objectId: OBJ };
    const decision = broker.evaluate({
      tool: "browser.submit", objectId: OBJ, plan,
      authorization: authorizeFor(plan, { scope: "browser.submit" }),
    });
    expect(decision.autoExecute).toBe(false);
    expect(decision.reason).toContain("Ready to Send");
  });

  it("returns to the ordinary approval flow once readiness is satisfied", () => {
    broker.useReadiness(gate([]));
    const decision = broker.evaluate({ tool: "browser.submit", objectId: OBJ, args: { priceUsd: 18 } });
    expect(decision.notReady ?? []).toHaveLength(0);
    expect(decision.level).toBe("PURCHASE");
    expect(decision.autoExecute).toBe(false);   // still needs a person, for the money
  });

  it("does not gate an action that names no object", () => {
    broker.useReadiness(gate([{ profileId: "send", profileName: "Ready to Send", blockers: ["x"] }]));
    expect(broker.evaluate({ tool: "image.transform" }).autoExecute).toBe(true);
  });
});


describe("permission is bound to the plan, not to the word yes", () => {
  const plan = {
    tool: "browser.submit",
    args: { action: "Book court", when: "5:00 PM", priceUsd: 18 },
    objectId: null, destination: "tennis.example", estimatedUsd: 18,
  };

  it("refuses when the arguments changed after approval", () => {
    const auth = authorizeFor(plan, { scope: "tennis.example", spendLimitUsd: 18 });
    // The person approved a 5:00 PM court. This is a different one.
    const changed = { ...plan, args: { ...plan.args, when: "9:00 PM" } };

    const d = broker.evaluate({
      tool: "browser.submit", args: changed.args, scope: "tennis.example",
      plan: changed, authorization: auth,
    });
    expect(d.autoExecute).toBe(false);
    expect(d.reason).toContain("what was approved is not what is about to run");
  });

  it("refuses when the price rose above what was approved", () => {
    const auth = authorizeFor(plan, { scope: "tennis.example", spendLimitUsd: 18 });
    const dearer = { ...plan, args: { ...plan.args, priceUsd: 45 }, estimatedUsd: 45 };
    const d = broker.evaluate({
      tool: "browser.submit", args: dearer.args, scope: "tennis.example",
      plan: dearer, authorization: auth,
    });
    expect(d.autoExecute).toBe(false);
    expect(d.reason).toContain("what was approved is not what is about to run");
  });

  it("refuses an approval granted for somewhere else", () => {
    const auth = authorizeFor(plan, { scope: "othersite.example", spendLimitUsd: 18 });
    const d = broker.evaluate({
      tool: "browser.submit", args: plan.args, scope: "tennis.example",
      plan, authorization: auth,
    });
    expect(d.autoExecute).toBe(false);
    expect(d.reason).toContain("was for othersite.example");
  });

  it("refuses an expired approval", () => {
    const auth = { ...authorizeFor(plan, { scope: "tennis.example", spendLimitUsd: 18 }), expiresAt: Date.now() - 1 };
    const d = broker.evaluate({
      tool: "browser.submit", args: plan.args, scope: "tennis.example", plan, authorization: auth,
    });
    expect(d.autoExecute).toBe(false);
    expect(d.reason).toContain("expired");
  });

  it("refuses an approval offered without the plan it covers", () => {
    const auth = authorizeFor(plan, { scope: "tennis.example", spendLimitUsd: 18 });
    const d = broker.evaluate({ tool: "browser.submit", args: plan.args, authorization: auth });
    expect(d.autoExecute).toBe(false);
    expect(d.reason).toContain("without the plan it covers");
  });

  it("digests the same plan identically regardless of key order", () => {
    expect(planDigest({ tool: "a", args: { x: 1, y: 2 } }))
      .toBe(planDigest({ tool: "a", args: { y: 2, x: 1 } }));
    expect(planDigest({ tool: "a", args: { x: 1 } }))
      .not.toBe(planDigest({ tool: "a", args: { x: 2 } }));
  });
});
