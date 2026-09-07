import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IdentityRef } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { SessionBroker, type IdentityProbe } from "./index.js";

let dir: string, g: ObjectGraph, sessions: SessionBroker;

/** Stands in for the visible Electron browser being signed into a site. */
const signedInProbe: IdentityProbe = {
  identitiesFor: async (domain): Promise<IdentityRef[]> => [{
    id: "11111111-1111-4111-8111-111111111111",
    domain, label: "signed in as ada@example.com",
    partition: "persist:web:default", lastSeenAt: Date.now(),
  }],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-sessions-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  sessions = new SessionBroker(g.db, signedInProbe);
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("M1 issues anonymous grants only", () => {
  it("authorizes anonymously even when the visible browser is signed in", async () => {
    const identities = await sessions.listIdentities("ebay.com");
    expect(identities).toHaveLength(1);           // XENIUR knows the user is signed in

    const grant = await sessions.authorize("ebay.com", { id: "t1", title: "Sell table" });
    expect(grant.kind).toBe("anonymous");         // and still does not act as them
    expect(grant.domain).toBe("ebay.com");
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
  });

  it("hands Hands a context with nothing in it", async () => {
    const grant = await sessions.authorize("ebay.com");
    const ctx = await sessions.getAutomationContext("ebay.com", grant);

    expect(ctx.storageState).toBeNull();
    expect(ctx.options).toEqual({ acceptDownloads: false, bypassCSP: false });

    // No cookie, token, header or credential escapes through this object by any name.
    const serialised = JSON.stringify(ctx).toLowerCase();
    for (const forbidden of ["cookie", "token", "session=", "authorization", "password", "persist:web"]) {
      expect(serialised, `automation context leaked "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("exposes identities as labels, never as anything usable", async () => {
    const [identity] = await sessions.listIdentities("ebay.com");
    expect(identity?.label).toBe("signed in as ada@example.com");
    expect(Object.keys(identity ?? {}).sort())
      .toEqual(["domain", "id", "label", "lastSeenAt", "partition"]);
  });

  it("refuses to build a context even from a stored delegated grant", async () => {
    // Written straight into the table, because the broker will never issue one.
    const grantId = "22222222-2222-4222-8222-222222222222";
    g.db.prepare(
      `INSERT INTO session_grants (grant_id, kind, domain, task_id, identity_id, scope,
                                   created_at, expires_at, revoked_at)
       VALUES (?, 'delegated', 'ebay.com', NULL, ?, '["listings:create"]', ?, ?, NULL)`,
    ).run(grantId, "33333333-3333-4333-8333-333333333333", Date.now(), Date.now() + 60_000);

    const delegated = {
      kind: "delegated" as const, grantId, domain: "ebay.com", taskId: null,
      identityId: "33333333-3333-4333-8333-333333333333",
      scope: ["listings:create"], expiresAt: Date.now() + 60_000,
    };
    await expect(sessions.getAutomationContext("ebay.com", delegated))
      .rejects.toThrow("not implemented in V1");
  });
});

describe("a step that truly needs an identity parks instead of improvising", () => {
  it("throws identity_required with an instruction the person can act on", async () => {
    await expect(sessions.requireIdentity("ebay.com", "task-1")).rejects.toMatchObject({
      code: "identity_required", domain: "ebay.com",
    });
    await sessions.requireIdentity("ebay.com", "task-1").catch((e: Error) => {
      expect(e.message).toContain("Sign in inside the XENIUR browser");
      expect(e.message).toContain("will not copy your session");
    });
  });
});

describe("grants are scoped, expiring and revocable", () => {
  it("refuses a grant issued for a different domain", async () => {
    const grant = await sessions.authorize("ebay.com");
    await expect(sessions.getAutomationContext("evil.example", grant))
      .rejects.toThrow("is for ebay.com");
  });

  it("refuses an expired grant", async () => {
    const brief = new SessionBroker(g.db, signedInProbe, -1);
    const grant = await brief.authorize("ebay.com");
    await expect(brief.getAutomationContext("ebay.com", grant)).rejects.toThrow("expired");
  });

  it("refuses a revoked grant and records the revocation", async () => {
    const grant = await sessions.authorize("ebay.com");
    sessions.revoke(grant.grantId);
    expect(sessions.isRevoked(grant.grantId)).toBe(true);
    await expect(sessions.getAutomationContext("ebay.com", grant)).rejects.toThrow("revoked");
    expect(sessions.grantsFor("ebay.com")[0]?.revokedAt).not.toBeNull();
  });

  it("records every grant it issues, so a receipt can name one", async () => {
    await sessions.authorize("ebay.com", { id: "t1", title: "Sell table" });
    await sessions.authorize("ebay.com", { id: "t2", title: "Watch price" });
    expect(sessions.grantsFor("ebay.com")).toHaveLength(2);
    expect(sessions.grantsFor("ebay.com").every((r) => r.kind === "anonymous")).toBe(true);
  });
});

describe("a grant object is a claim, not evidence", () => {
  it("refuses a forged domain even though the grantId is real", async () => {
    const real = await sessions.authorize("ebay.com");
    const forged = { ...real, domain: "evil.example" };
    await expect(sessions.getAutomationContext("evil.example", forged))
      .rejects.toThrow("is for ebay.com");
  });

  it("refuses a forged expiry on an expired grant", async () => {
    const brief = new SessionBroker(g.db, signedInProbe, -1);
    const expired = await brief.authorize("ebay.com");
    const forged = { ...expired, expiresAt: Date.now() + 3_600_000 };
    await expect(brief.getAutomationContext("ebay.com", forged)).rejects.toThrow("expired");
  });

  it("refuses a grantId that was never issued", async () => {
    const real = await sessions.authorize("ebay.com");
    const invented = { ...real, grantId: "99999999-9999-4999-8999-999999999999" };
    await expect(sessions.getAutomationContext("ebay.com", invented)).rejects.toThrow("no such grant");
  });

  it("returns the stored grant, not the one it was handed", async () => {
    const real = await sessions.authorize("ebay.com", { id: "t1", title: "Sell table" });
    const forged = { ...real, taskId: "22222222-2222-4222-8222-222222222222" };
    const ctx = await sessions.getAutomationContext("ebay.com", forged);
    expect(ctx.grant.taskId).toBe("t1");
  });
});
