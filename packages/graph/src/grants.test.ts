import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRANT_REFUSALS, GrantRefused, describeGrant, type GrantRefusalCode } from "@xeniur/core";
import { ObjectGraph } from "./index.js";

/**
 * A grant is what the person allowed, exactly. Signing in is not reading; reading is not
 * sending; a draft is not an action. Every refusal has a code and words, and nothing a tool
 * observed can create, widen or renew one.
 */
const HOUR = 3_600_000;
let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-grants-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Cold-weather shell", emoji: "◒" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const action = (over: Record<string, unknown> = {}) => g.grants.issue({
  kind: "action", route: "embedded_tab", worldId, goalId: null, profileId: "p1", tabId: "tab-1", webContentsId: 7,
  origins: ["https://supplier.example"], accountLabel: "you@example.org", accountVerifiedBy: "person",
  actionClasses: ["submit"], reviewDigest: "a".repeat(64), payloadVersionIds: ["v1"], oneUse: true,
  expiresAt: Date.now() + HOUR, because: "send the order you reviewed", ...over,
});
const need = (over: Record<string, unknown> = {}) => ({ kind: "action" as const, tabId: "tab-1", webContentsId: 7, url: "https://supplier.example/orders", actionClass: "submit" as const, digest: "a".repeat(64), ...over });

describe("a grant is asserted, never assumed", () => {
  it("allows exactly what it names, once, and says so in a sentence", () => {
    const grant = action();
    expect(describeGrant(grant)).toMatch(/assistant action on https:\/\/supplier\.example, as you@example\.org, until .*, once\./);
    expect(g.grants.assert(grant.id, need()).state).toBe("consumed");
    expect(() => g.grants.assert(grant.id, need())).toThrow(/for one action, and it was used/);
  });

  it("refuses the wrong tab, the wrong view, another origin, another class, a changed plan and an unapproved version", () => {
    const codes: GrantRefusalCode[] = [];
    const tries: Array<[Record<string, unknown>, GrantRefusalCode]> = [
      [{ tabId: "tab-2" }, "wrong_tab"],
      [{ webContentsId: 9 }, "wrong_tab"],
      [{ url: "https://elsewhere.example/x" }, "out_of_scope"],
      [{ actionClass: "api_post" }, "class_not_granted"],
      [{ digest: "b".repeat(64) }, "digest_mismatch"],
      [{ kind: "observation" }, "wrong_kind"],
    ];
    for (const [over, code] of tries) {
      const grant = action();
      try { g.grants.assert(grant.id, need(over)); expect.unreachable(`${code} was not refused`); }
      catch (e) { expect(e).toBeInstanceOf(GrantRefused); codes.push((e as GrantRefused).code); }
    }
    expect(codes).toEqual(tries.map(([, c]) => c));

    const versioned = action({ oneUse: false, dataVersionIds: ["v1"] });
    expect(() => g.grants.assert(versioned.id, need({ dataVersionIds: ["v2"] }))).toThrow(/changed after you approved/);
  });

  it("take over pauses, stop revokes, and an expired grant fails closed", () => {
    const paused = action({ oneUse: false });
    g.grants.pause(paused.id, "you took over");
    expect(() => g.grants.assert(paused.id, need())).toThrow(/took over/);
    g.grants.resume(paused.id);
    expect(g.grants.assert(paused.id, need()).state).toBe("active");

    const stopped = action({ oneUse: false });
    g.grants.revoke(stopped.id, "you stopped this");
    expect(() => g.grants.assert(stopped.id, need())).toThrow(/stopped/);

    const old = action({ oneUse: false });
    g.db.prepare(`UPDATE grants SET expires_at = ? WHERE id = ?`).run(Date.now() - 1, old.id);
    expect(() => g.grants.assert(old.id, need())).toThrow(/expired/);
    expect(g.grants.get(old.id)!.state).toBe("expired");
  });

  it("amending makes a new revision and the old one stops working", () => {
    const first = action({ oneUse: false });
    const second = g.grants.revise(first.id, { origins: ["https://supplier.example", "https://pay.example"] });
    expect(second.revision).toBe(2);
    expect(g.grants.get(first.id)!.state).toBe("revoked");
    expect(() => g.grants.assert(first.id, need())).toThrow(/stopped|revoked/);
    expect(g.grants.assert(second.id, need({ url: "https://pay.example/checkout" })).id).toBe(second.id);
  });

  it("limits bound how many and how much", () => {
    const twice = action({ oneUse: false, limits: { maxActions: 2, maxAmount: 50, currency: "USD" } });
    g.grants.assert(twice.id, need()); g.grants.assert(twice.id, need());
    expect(() => g.grants.assert(twice.id, need())).toThrow(/limit|2 actions/);
    const priced = action({ oneUse: false, limits: { maxActions: null, maxAmount: 50, currency: "USD" } });
    expect(() => g.grants.assert(priced.id, need({ amount: 51 }))).toThrow(/limit/);
  });

  it("observation is continuous while allowed and spends nothing; revokeAll clears everything at startup", () => {
    const watch = g.grants.issue({ kind: "observation", route: "embedded_tab", worldId, tabId: "tab-1", webContentsId: 7,
      origins: ["https://supplier.example"], expiresAt: Date.now() + HOUR, because: "read this tab for this task" });
    for (let i = 0; i < 5; i += 1) g.grants.assert(watch.id, { kind: "observation", tabId: "tab-1", webContentsId: 7, url: "https://supplier.example/a" });
    expect(g.grants.get(watch.id)!.uses).toBe(0);
    expect(g.grants.active(worldId).length).toBeGreaterThan(0);
    expect(g.grants.revokeAll("XENIUR restarted")).toBeGreaterThan(0);
    expect(g.grants.active(worldId)).toEqual([]);
  });

  it("records what happened to a grant, including every refusal", () => {
    const grant = action({ oneUse: false });
    try { g.grants.assert(grant.id, need({ url: "https://elsewhere.example" })); } catch { /* recorded */ }
    g.grants.assert(grant.id, need());
    const kinds = g.grants.eventsOf(grant.id).map((e) => e.kind);
    expect(kinds).toEqual(["issued", "refused", "used"]);
    expect(GRANT_REFUSALS).toContain("out_of_scope");
  });
});

describe("nothing observed can mint a grant", () => {
  it("grants.issue is called only from the IPC layer, never from the web or route code", () => {
    const root = join(process.cwd(), "apps/desktop/src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(p) || /\.test\./.test(p)) continue;
        if (!readFileSync(p, "utf8").includes("grants.issue(")) continue;
        if (!/main\/ipc\.ts$/.test(p)) offenders.push(p.slice(root.length + 1));
      }
    };
    walk(root);
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});
