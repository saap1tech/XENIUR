import type { ActionClass, Grant, GrantInput, GrantKind, GrantRefusalCode } from "@xeniur/core";
import { GrantRefused, GrantSchema, newId, now, originOf } from "@xeniur/core";
import type { Db } from "./db.js";

/** What a caller is asking to do, checked against what the person allowed. */
export interface GrantNeed {
  kind: GrantKind;
  tabId?: string | null;
  webContentsId?: number | null;
  url?: string | null;
  actionClass?: ActionClass;
  digest?: string | null;
  dataVersionIds?: readonly string[];
  destination?: string | null;
  amount?: number | null;
}

/**
 * Grants: issued by the person, checked in the trusted process, and never widened by anything
 * a tool observed. `assert` is the one door — before reading a page, before anything reaches a
 * model, and at dispatch. It refuses in words with a code, and records the refusal, so a sheet
 * can say what happened and why rather than failing silently.
 */
export class GrantStore {
  constructor(private readonly db: Db) {}

  issue(input: Omit<GrantInput, "id" | "revision" | "createdAt" | "state" | "uses" | "supersededBy">): Grant {
    const g = GrantSchema.parse({ ...input, id: newId(), revision: 1, uses: 0, state: "active", createdAt: now(), supersededBy: null });
    this.#write(g);
    this.#event(g.id, "issued", g.kind);
    return g;
  }

  /** Amending is a new revision; the old one stops working. Nothing is edited in place. */
  revise(id: string, patch: Partial<Omit<GrantInput, "id" | "revision" | "createdAt">>): Grant {
    const current = this.get(id);
    if (!current) throw new GrantRefused("no_grant", id.slice(0, 8));
    const next = GrantSchema.parse({ ...current, ...patch, id: newId(), revision: current.revision + 1, uses: 0, state: "active", createdAt: now(), supersededBy: null });
    return this.db.transaction(() => {
      this.#write(next);
      this.db.prepare(`UPDATE grants SET state = 'revoked', superseded_by = ? WHERE id = ?`).run(next.id, id);
      this.#event(id, "revised", next.id);
      this.#event(next.id, "issued", `revision ${next.revision}`);
      return next;
    })();
  }

  pause(id: string, why: string): Grant | null { return this.#state(id, "paused", why); }
  resume(id: string): Grant | null {
    const g = this.get(id);
    if (!g || g.state !== "paused") return g;
    return this.#state(id, "active", "resumed by you");
  }
  revoke(id: string, why: string): Grant | null { return this.#state(id, "revoked", why); }

  /** Every grant revoked — at startup, and whenever the person leaves everything behind. */
  revokeAll(why: string): number {
    const rows = this.db.prepare(`SELECT id FROM grants WHERE state IN ('active','paused')`).all() as Array<{ id: string }>;
    for (const r of rows) this.#state(r.id, "revoked", why);
    return rows.length;
  }

  /** Grants this project can still use, most recent first. */
  active(worldId: string, kind?: GrantKind): Grant[] {
    const t = now();
    const rows = this.db.prepare(
      kind
        ? `SELECT * FROM grants WHERE world_id = ? AND kind = ? AND state IN ('active','paused') ORDER BY created_at DESC`
        : `SELECT * FROM grants WHERE world_id = ? AND state IN ('active','paused') ORDER BY created_at DESC`,
    ).all(...(kind ? [worldId, kind] : [worldId])) as Row[];
    const out: Grant[] = [];
    for (const r of rows) {
      const g = fromRow(r);
      if (g.expiresAt <= t) { this.#state(g.id, "expired", "reached its expiry"); continue; }
      out.push(g);
    }
    return out;
  }

  get(id: string): Grant | null {
    const r = this.db.prepare(`SELECT * FROM grants WHERE id = ?`).get(id) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  /**
   * The one door. Refuses with a code and records it; on success counts the use and consumes
   * a one-use grant, so the same approval can never cover a second action.
   */
  assert(id: string, need: GrantNeed): Grant {
    const g = this.get(id);
    const refuse = (code: GrantRefusalCode, detail = ""): never => {
      if (g) this.#event(g.id, "refused", `${code}${detail ? `: ${detail}` : ""}`);
      throw new GrantRefused(code, detail);
    };
    if (!g) throw new GrantRefused("no_grant", id.slice(0, 8));
    if (g.state === "revoked") refuse("revoked");
    if (g.state === "paused") refuse("paused");
    if (g.state === "consumed") refuse("consumed");
    if (g.state === "expired" || g.expiresAt <= now()) { this.#state(g.id, "expired", "reached its expiry"); refuse("expired"); }
    if (g.kind !== need.kind) refuse("wrong_kind", need.kind);

    if (need.tabId !== undefined && need.tabId !== null && g.tabId !== null && g.tabId !== need.tabId) refuse("wrong_tab", need.tabId);
    if (need.webContentsId !== undefined && need.webContentsId !== null && g.webContentsId !== null && g.webContentsId !== need.webContentsId) refuse("wrong_tab", `view ${need.webContentsId}`);
    if (need.url && g.origins.length > 0) {
      const origin = originOf(need.url);
      if (!origin || !g.origins.includes(origin)) refuse("out_of_scope", origin ?? need.url);
    }
    if (need.actionClass && !g.actionClasses.includes(need.actionClass)) refuse("class_not_granted", need.actionClass);
    if (need.digest !== undefined && need.digest !== null && g.reviewDigest !== null && g.reviewDigest !== need.digest) refuse("digest_mismatch");
    if (need.destination && g.modelDestinations.length > 0 && !g.modelDestinations.includes(need.destination)) refuse("out_of_scope", need.destination);
    if (need.dataVersionIds && g.dataVersionIds.length > 0) {
      const missing = need.dataVersionIds.filter((v) => !g.dataVersionIds.includes(v));
      if (missing.length > 0) refuse("version_not_approved", `${missing.length} item${missing.length === 1 ? "" : "s"}`);
    }
    if (need.amount !== undefined && need.amount !== null && g.limits.maxAmount !== null && need.amount > g.limits.maxAmount) {
      refuse("limit", `${need.amount} over ${g.limits.maxAmount}${g.limits.currency ? ` ${g.limits.currency}` : ""}`);
    }
    if (g.oneUse && g.uses >= 1) refuse("one_use_spent");
    if (g.limits.maxActions !== null && g.uses >= g.limits.maxActions) refuse("limit", `${g.limits.maxActions} actions`);

    // Only reading counts no use: observation is continuous while it is allowed.
    if (g.kind !== "observation") {
      this.db.prepare(`UPDATE grants SET uses = uses + 1 WHERE id = ?`).run(g.id);
      this.#event(g.id, "used", need.actionClass ?? need.kind);
      if (g.oneUse) this.#state(g.id, "consumed", "the one action it allowed");
    }
    return this.get(g.id)!;
  }

  /** Everything that happened to a grant, for a sheet that says what happened. */
  eventsOf(id: string): Array<{ kind: string; detail: string; at: number }> {
    return this.db.prepare(`SELECT kind, detail, at FROM grant_events WHERE grant_id = ? ORDER BY at, rowid`).all(id) as Array<{ kind: string; detail: string; at: number }>;
  }

  /* -------------------------------------------------------------- internals */

  #state(id: string, state: Grant["state"], why: string): Grant | null {
    const g = this.get(id);
    if (!g) return null;
    this.db.prepare(`UPDATE grants SET state = ? WHERE id = ?`).run(state, id);
    this.#event(id, state === "active" ? "resumed" : state === "paused" ? "paused" : state === "consumed" ? "consumed" : "revoked", why);
    return this.get(id);
  }

  #write(g: Grant): void {
    this.db.prepare(
      `INSERT INTO grants (id, revision, kind, route, world_id, goal_id, profile_id, tab_id, web_contents_id, origins,
         account_label, account_verified_by, data_version_ids, model_destinations, action_classes, review_digest,
         payload_version_ids, one_use, uses, limits, expires_at, state, because, created_at, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(g.id, g.revision, g.kind, g.route, g.worldId, g.goalId, g.profileId, g.tabId, g.webContentsId, JSON.stringify(g.origins),
      g.accountLabel, g.accountVerifiedBy, JSON.stringify(g.dataVersionIds), JSON.stringify(g.modelDestinations),
      JSON.stringify(g.actionClasses), g.reviewDigest, JSON.stringify(g.payloadVersionIds), g.oneUse ? 1 : 0, g.uses,
      JSON.stringify(g.limits), g.expiresAt, g.state, g.because, g.createdAt, g.supersededBy);
  }

  #event(grantId: string, kind: string, detail: string): void {
    this.db.prepare(`INSERT INTO grant_events (id, grant_id, kind, detail, at) VALUES (?, ?, ?, ?, ?)`).run(newId(), grantId, kind, detail, now());
  }
}

type Row = {
  id: string; revision: number; kind: GrantKind; route: Grant["route"]; world_id: string; goal_id: string | null;
  profile_id: string | null; tab_id: string | null; web_contents_id: number | null; origins: string;
  account_label: string | null; account_verified_by: "person" | null; data_version_ids: string; model_destinations: string;
  action_classes: string; review_digest: string | null; payload_version_ids: string; one_use: number; uses: number;
  limits: string; expires_at: number; state: Grant["state"]; because: string; created_at: number; superseded_by: string | null;
};
const fromRow = (r: Row): Grant => GrantSchema.parse({
  id: r.id, revision: r.revision, kind: r.kind, route: r.route, worldId: r.world_id, goalId: r.goal_id,
  profileId: r.profile_id, tabId: r.tab_id, webContentsId: r.web_contents_id, origins: JSON.parse(r.origins),
  accountLabel: r.account_label, accountVerifiedBy: r.account_verified_by, dataVersionIds: JSON.parse(r.data_version_ids),
  modelDestinations: JSON.parse(r.model_destinations), actionClasses: JSON.parse(r.action_classes), reviewDigest: r.review_digest,
  payloadVersionIds: JSON.parse(r.payload_version_ids), oneUse: r.one_use === 1, uses: r.uses, limits: JSON.parse(r.limits),
  expiresAt: r.expires_at, state: r.state, because: r.because, createdAt: r.created_at, supersededBy: r.superseded_by,
});
