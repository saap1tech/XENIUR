import type { PermissionDecision, PermissionLevel, Receipt, Tool } from "@xeniur/core";
import type { Authorization, PlanShape } from "@xeniur/core";
import {
  ApprovalRequired, NEVER_REMEMBERABLE, NotReady, assertAuthorizes, isAutoExecutable,
  newId, now, rankOf, specOf,
} from "@xeniur/core";
import type { Db } from "@xeniur/graph";
import { PreviewRegistry, type Previewer } from "./preview.js";

/**
 * Decides whether the readiness profiles guarding a tool are satisfied.
 *
 * Supplied by the host rather than imported, so the Permission Broker keeps knowing
 * nothing about recipes, checks or the graph — it asks one question and gets an answer.
 */
export interface ReadinessGate {
  /** Unmet action profiles for this tool and object, each with its blockers. */
  unmet(tool: Tool, objectId: string): Array<{ profileId: string; profileName: string; blockers: string[] }>;
}

export interface PermissionRequest {
  tool: Tool;
  args?: Record<string, unknown>;
  /** Scope a remembered decision applies to, e.g. a domain. Defaults to the tool. */
  scope?: string;
  /**
   * Permission for exactly this plan. A bare boolean used to be enough, which meant a
   * yes survived the plan, its inputs, its destination and its price all changing.
   */
  authorization?: Authorization;
  /** The plan being authorised, so the digest can be recomputed rather than trusted. */
  plan?: PlanShape;
  /**
   * True when the reason for doing this came out of content XENIUR does not control —
   * a web page, a document, a model's echo of either.
   */
  derivedFromUntrusted?: boolean;
  /** The Object this action is about, when there is one. Needed for readiness gating. */
  objectId?: string;
}

export interface Decision {
  level: PermissionLevel;
  /** May this run right now, unattended? */
  autoExecute: boolean;
  requiresApproval: boolean;
  preview: string;
  reason: string;
  /** Action profiles blocking this, when readiness is what stopped it. */
  notReady?: Array<{ profileId: string; profileName: string; blockers: string[] }>;
}

/**
 * The deterministic gate between every AI decision and every external side effect.
 *
 * It reads a fixed level table, never a model's opinion about how risky something is.
 * Reversible local work runs; anything that reaches a person, a service, money, or
 * deletion stops and asks, with a preview the person can read.
 */
export class PermissionBroker {
  private readonly previews: PreviewRegistry;

  #readiness: ReadinessGate | null = null;

  constructor(private readonly db: Db, previewers: Partial<Record<Tool, Previewer>> = {}) {
    this.previews = new PreviewRegistry(previewers);
  }

  /**
   * Wires readiness gating in. "Do not send the deck before the fonts embed" then lives in
   * the same place as "do not spend money unasked", which is the only place either can be
   * relied on.
   */
  useReadiness(gate: ReadinessGate | null): void { this.#readiness = gate; }

  registerPreviewer(tool: Tool, previewer: Previewer): void {
    this.previews.register(tool, previewer);
  }

  evaluate(request: PermissionRequest): Decision {
    const args = request.args ?? {};
    const base = specOf(request.tool).permission;
    const { level, reason } = this.escalate(base, request, args);
    const preview = this.previews.render(request.tool, args);

    // Readiness is checked before anything else, including an explicit approval: a person
    // saying yes does not make a stale deck ready to send. They are told what is missing.
    const unmet = request.objectId && this.#readiness
      ? this.#readiness.unmet(request.tool, request.objectId)
      : [];
    if (unmet.length > 0) {
      const first = unmet[0]!;
      return {
        level, autoExecute: false, requiresApproval: true, preview,
        notReady: unmet,
        reason: `${first.profileName} is not satisfied: ${first.blockers[0] ?? "requirements unmet"}`,
      };
    }

    if (request.authorization) {
      // Recomputed from the plan about to run, never taken from the caller's word.
      if (!request.plan) {
        return { level, autoExecute: false, requiresApproval: true, preview,
                 reason: "an approval was offered without the plan it covers" };
      }
      try {
        assertAuthorizes(request.authorization, request.plan, request.scope ?? request.tool);
        return { level, autoExecute: true, requiresApproval: false, preview,
                 reason: "approved by the person, for exactly this" };
      } catch (err) {
        return {
          level, autoExecute: false, requiresApproval: true, preview,
          reason: err instanceof Error ? err.message : "that approval does not apply",
        };
      }
    }

    if (isAutoExecutable(level)) {
      // Reversible and local. It runs, and it writes a version so it can be undone.
      return { level, autoExecute: true, requiresApproval: false, preview, reason };
    }

    // A remembered "allow" can cover COMMUNICATE and COMMIT, but never money or deletion,
    // and never when the justification came from content XENIUR does not control.
    if (!request.derivedFromUntrusted && !NEVER_REMEMBERABLE.has(level)) {
      const remembered = this.recall(request.scope ?? request.tool, level);
      if (remembered === "allow_session") {
        return { level, autoExecute: true, requiresApproval: false, preview,
                 reason: "allowed for this session" };
      }
      if (remembered === "deny") {
        return { level, autoExecute: false, requiresApproval: true, preview,
                 reason: "previously denied for this scope" };
      }
    }

    return { level, autoExecute: false, requiresApproval: true, preview, reason };
  }

  /**
   * Escalation only ever raises. Nothing — not a plan, not a page, not a remembered
   * decision — can lower a level below what the tool table says.
   */
  private escalate(
    base: PermissionLevel, request: PermissionRequest, args: Record<string, unknown>,
  ): { level: PermissionLevel; reason: string } {
    let level = base;
    let reason = `${request.tool} is ${base} by definition`;

    const raise = (to: PermissionLevel, why: string) => {
      if (rankOf(to) > rankOf(level)) { level = to; reason = why; }
    };

    const amount = ["priceUsd", "amountUsd", "totalUsd"]
      .map((k) => args[k]).find((v) => typeof v === "number" && v > 0);
    if (typeof amount === "number") raise("PURCHASE", `it spends $${amount.toFixed(2)}`);

    if (args["destructive"] === true || args["permanent"] === true) {
      raise("DESTRUCTIVE", "it destroys something permanently");
    }

    if (request.derivedFromUntrusted && rankOf(level) >= rankOf("COMMUNICATE")) {
      reason = "a page asked for this, so a person must confirm it";
    }
    return { level, reason };
  }

  /**
   * Throws ApprovalRequired when a person must decide. The queue catches it and parks
   * the task; the work is not lost and nothing has happened yet.
   */
  guard(request: PermissionRequest): Decision {
    const decision = this.evaluate(request);
    if (decision.notReady && decision.notReady.length > 0) {
      const first = decision.notReady[0]!;
      throw new NotReady(first.profileId, first.profileName, first.blockers);
    }
    if (!decision.autoExecute) {
      throw new ApprovalRequired(decision.preview, decision.level, decision.reason);
    }
    return decision;
  }

  /**
   * Records "allow for this session" / "deny". Refused outright for PURCHASE and
   * DESTRUCTIVE: spending money and destroying things are confirmed one at a time,
   * every time, and no interface offers a way around that.
   */
  remember(scope: string, level: PermissionLevel, decision: PermissionDecision,
           ttlMs: number | null = null): boolean {
    if (NEVER_REMEMBERABLE.has(level) && decision !== "deny") return false;
    if (decision === "allow_once") return false;   // nothing to remember
    this.db.prepare(
      `INSERT INTO permissions (id, scope, level, decision, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId(), scope, level, decision, now(), ttlMs === null ? null : now() + ttlMs);
    return true;
  }

  recall(scope: string, level: PermissionLevel): PermissionDecision | null {
    const row = this.db.prepare(
      `SELECT decision FROM permissions
       WHERE scope = ? AND level = ? AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC LIMIT 1`,
    ).get(scope, level, now()) as { decision: PermissionDecision } | undefined;
    return row?.decision ?? null;
  }

  forget(scope: string): void {
    this.db.prepare(`DELETE FROM permissions WHERE scope = ?`).run(scope);
  }

  /** Written after anything consequential, so an outcome can always be audited. */
  writeReceipt(actionId: string, receipt: Receipt): void {
    this.db.prepare(`UPDATE actions SET receipt = ? WHERE id = ?`)
      .run(JSON.stringify(receipt), actionId);
  }
}
