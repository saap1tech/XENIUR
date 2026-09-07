import type { IdentityRef, SessionGrant, TaskRef } from "@xeniur/core";
import { IdentityRequiredError, newId, now } from "@xeniur/core";
import type { Db } from "@xeniur/graph";

/**
 * What Hands is handed to drive a browser with. Note what is *not* here: no cookies,
 * no storage state, no headers, no tokens. In M1 this is deliberately an empty,
 * anonymous context — the type has nowhere to put a credential even by accident.
 */
export interface AutomationContext {
  readonly grant: SessionGrant;
  /** Playwright's storageState input. Always null in M1; nothing is carried over. */
  readonly storageState: null;
  readonly options: { readonly acceptDownloads: false; readonly bypassCSP: false };
}

/**
 * Reports which domains the *visible* XENIUR browser is signed into. Implemented in the
 * main process against Electron's sessions; it returns labels for display only and never
 * the underlying cookies. The default implementation reports nothing.
 */
export interface IdentityProbe {
  identitiesFor(domain: string): Promise<IdentityRef[]>;
}

export const NO_IDENTITIES: IdentityProbe = { identitiesFor: async () => [] };

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Identity as a capability.
 *
 * The visible Electron browser and Playwright Hands are separate browsers — correct for
 * privilege isolation, and therefore separate identities. Signing into a site in the
 * XENIUR browser does not sign Hands in, and the fix is emphatically *not* copying
 * cookies across: that turns a clean boundary into an unscoped credential handover.
 *
 * So a session is granted, not inherited. Grants are rows: scoped to a domain and a
 * task, expiring, revocable, and recorded on every receipt. M1 issues only anonymous
 * grants; `delegated` exists in the type so M2 can implement explicit scoped delegation
 * without reshaping anything above it.
 */
export class SessionBroker {
  constructor(
    private readonly db: Db,
    private readonly probe: IdentityProbe = NO_IDENTITIES,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  /** Display-only. Never returns cookies, tokens, or anything usable as a credential. */
  async listIdentities(domain: string): Promise<IdentityRef[]> {
    return this.probe.identitiesFor(domain);
  }

  /**
   * M1 always returns an anonymous grant. A caller that genuinely needs a signed-in
   * identity must call `requireIdentity`, which parks the task rather than improvising.
   */
  async authorize(domain: string, task: TaskRef | null = null): Promise<SessionGrant> {
    const grant: SessionGrant = {
      kind: "anonymous", grantId: newId(), domain,
      taskId: task?.id ?? null, expiresAt: now() + this.ttlMs,
    };
    this.db.prepare(
      `INSERT INTO session_grants (grant_id, kind, domain, task_id, identity_id, scope,
                                   created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL, '[]', ?, ?, NULL)`,
    ).run(grant.grantId, grant.kind, grant.domain, grant.taskId, now(), grant.expiresAt);
    return grant;
  }

  /**
   * Verifies the grant against the stored row, and returns a context built from that row.
   *
   * The object handed in is a *claim*, never evidence: reading `domain`, `expiresAt` or
   * `kind` off it would let a caller widen its own access simply by editing an object it
   * already holds. Only the grantId is taken from the caller; everything else is re-read.
   */
  async getAutomationContext(domain: string, grant: SessionGrant): Promise<AutomationContext> {
    const row = this.db.prepare(
      `SELECT grant_id, kind, domain, task_id, identity_id, scope, expires_at, revoked_at
       FROM session_grants WHERE grant_id = ?`,
    ).get(grant.grantId) as {
      grant_id: string; kind: string; domain: string; task_id: string | null;
      identity_id: string | null; scope: string; expires_at: number; revoked_at: number | null;
    } | undefined;

    if (!row) throw new Error(`no such grant: ${grant.grantId}`);
    if (row.revoked_at !== null) throw new Error(`grant ${row.grant_id} was revoked`);
    if (row.expires_at <= now()) throw new Error(`grant ${row.grant_id} expired`);
    if (row.domain !== domain) {
      throw new Error(`grant ${row.grant_id} is for ${row.domain}, not ${domain}`);
    }
    if (row.kind === "delegated") {
      // The type exists so nothing has to be reshaped later. Issuing one is not
      // implemented, and failing loudly beats quietly handing over a real session.
      throw new Error("delegated session grants are not implemented in V1");
    }
    if (row.kind !== "anonymous") throw new Error(`unknown grant kind: ${row.kind}`);

    // Rebuilt from the row, so the returned grant is what is stored, not what was passed.
    const verified: SessionGrant = {
      kind: "anonymous", grantId: row.grant_id, domain: row.domain,
      taskId: row.task_id, expiresAt: row.expires_at,
    };
    return { grant: verified, storageState: null, options: { acceptDownloads: false, bypassCSP: false } };
  }

  /**
   * Called when a step genuinely needs a signed-in identity. It parks the task with an
   * explanation instead of reaching for the user's cookies.
   */
  async requireIdentity(domain: string, taskId: string | null): Promise<never> {
    throw new IdentityRequiredError(domain, taskId);
  }

  revoke(grantId: string): void {
    this.db.prepare(`UPDATE session_grants SET revoked_at = ? WHERE grant_id = ?`)
      .run(now(), grantId);
  }

  isRevoked(grantId: string): boolean {
    const r = this.db.prepare(`SELECT revoked_at FROM session_grants WHERE grant_id = ?`)
      .get(grantId) as { revoked_at: number | null } | undefined;
    return r?.revoked_at !== null && r?.revoked_at !== undefined;
  }

  grantsFor(domain: string): Array<{ grantId: string; kind: string; expiresAt: number; revokedAt: number | null }> {
    return (this.db.prepare(
      `SELECT grant_id, kind, expires_at, revoked_at FROM session_grants
       WHERE domain = ? ORDER BY created_at DESC`,
    ).all(domain) as Array<{ grant_id: string; kind: string; expires_at: number; revoked_at: number | null }>)
      .map((r) => ({ grantId: r.grant_id, kind: r.kind, expiresAt: r.expires_at, revokedAt: r.revoked_at }));
  }
}
