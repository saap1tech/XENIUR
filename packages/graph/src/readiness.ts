import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Check, Profile, ReadinessReport, Release, Requirement, RequirementResult,
} from "@xeniur/core";
import { NotReady, ProfilesFileSchema, newId, now } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";

export function loadProfiles(rootDir: string): Profile[] {
  const raw = JSON.parse(readFileSync(join(rootDir, "config", "profiles.json"), "utf8")) as unknown;
  return ProfilesFileSchema.parse(raw).profiles;
}

const has = (r: Requirement, key: string): boolean => Object.prototype.hasOwnProperty.call(r, key);

/**
 * Decides a readiness profile from evidence, and always explains itself.
 *
 * A requirement is never merely red: every result carries the measurement that decided it
 * and, where there is one obvious next step, what would move it forward. "Ready for 3D
 * Print is blocked" is useless; "the surface has 202 open boundary edges — this is not a
 * solid" is something a person can act on.
 */
export class ReadinessEvaluator {
  constructor(private readonly graph: ObjectGraph, private readonly profiles: readonly Profile[]) {}

  list(): readonly Profile[] { return this.profiles; }
  get(profileId: string): Profile | undefined { return this.profiles.find((p) => p.id === profileId); }

  /** Action profiles guarding a given tool. Used by the Permission Broker. */
  guarding(tool: string): Profile[] {
    return this.profiles.filter((p) => p.gates === "action" && p.tools.includes(tool));
  }

  evaluate(objectId: string, profileId: string): ReadinessReport | null {
    const profile = this.get(profileId);
    if (!profile) return null;

    const results = profile.requires.map((r) => this.#check(objectId, r));
    const blockers = results.filter((r) => !r.met);
    return {
      profileId: profile.id, profileName: profile.name, verifies: profile.verifies,
      gates: profile.gates,
      ready: blockers.length === 0, results, blockers,
    };
  }

  /** Every profile, so the readiness board can show what is met and what is not. */
  evaluateAll(objectId: string): ReadinessReport[] {
    return this.profiles
      .map((p) => this.evaluate(objectId, p.id))
      .filter((r): r is ReadinessReport => r !== null);
  }

  #check(objectId: string, requirement: Requirement): RequirementResult {
    if (has(requirement, "form")) return this.#checkForm(objectId, requirement as never);
    if (has(requirement, "check")) return this.#checkValidator(objectId, requirement as never);
    if (has(requirement, "fresh")) return this.#checkFresh(objectId, requirement);
    if (has(requirement, "release")) return this.#checkRelease(objectId, requirement as never);
    return { requirement, met: false, detail: "unrecognised requirement", remedy: null };
  }

  #checkForm(
    objectId: string,
    requirement: Extract<Requirement, { form: unknown }>,
  ): RequirementResult {
    const { role, modality, format } = requirement.form;
    const state = this.graph.currentState(objectId);
    const form = state?.forms.find((f) => f.role === role);
    if (!form) {
      return {
        requirement, met: false, detail: `there is no "${role}" yet`,
        remedy: `build ${role}`,
      };
    }
    const rep = this.graph.getRepresentation(form.representationId);
    if (!rep) {
      return { requirement, met: false, detail: `"${role}" points at nothing`, remedy: `rebuild ${role}` };
    }
    if (modality && rep.modality !== modality) {
      return {
        requirement, met: false,
        detail: `"${role}" is ${rep.modality}, not ${modality}`, remedy: null,
      };
    }
    if (format && rep.format !== format) {
      return {
        requirement, met: false,
        detail: `"${role}" is ${rep.format}, not ${format}`,
        remedy: `export ${role} as ${format}`,
      };
    }
    return {
      requirement, met: true,
      detail: `"${role}" is ${rep.modality}/${rep.format}`, remedy: null,
    };
  }

  #checkValidator(
    objectId: string,
    requirement: Extract<Requirement, { check: unknown }>,
  ): RequirementResult {
    const { validator, status, max, min, field, formRole } = requirement.check;

    // Resolve what currently occupies the role *first*. Evidence is only evidence if it
    // was measured on this representation, with these bytes. Selecting by validator alone
    // is how a rebuilt form used to inherit the previous form's check and stay "ready".
    let subject: { id: string; hash: string | null } | null = null;
    if (formRole) {
      const state = this.graph.currentState(objectId);
      const form = state?.forms.find((f) => f.role === formRole);
      if (!form) {
        return {
          requirement, met: false,
          detail: `there is no "${formRole}" to measure`, remedy: `build ${formRole}`,
        };
      }
      const rep = this.graph.getRepresentation(form.representationId);
      subject = { id: form.representationId, hash: rep?.blobHash ?? null };
    }

    const all = this.#checksFor(objectId, validator);
    const scoped = formRole ? all.filter((c) => c.formRole === formRole) : all;
    const current = subject
      ? scoped.filter((c) => c.subjectId === subject.id && c.subjectHash === subject.hash)
      : scoped.filter((c) => c.subjectKind !== "unbound");

    if (current.length === 0) {
      // Distinguish "never measured" from "measured, but not this" — they call for
      // different actions, and a person cannot tell them apart from a red light.
      const forThisRole = scoped.filter((c) => c.subjectKind !== "unbound");
      const onOlder = subject !== null && forThisRole.some((c) => c.subjectId !== subject.id);
      const bytesChanged = subject !== null &&
        forThisRole.some((c) => c.subjectId === subject.id && c.subjectHash !== subject.hash);
      const unboundOnly = scoped.length > 0 && forThisRole.length === 0;

      const detail = bytesChanged
        ? `${validator}: ${formRole} changed after this was measured`
        : onOlder
          ? `${validator}: measured on a previous version of ${formRole}`
          : unboundOnly
            ? `${validator}: an older measurement exists but does not say what it measured`
            : formRole
              ? `${validator} has not been measured on ${formRole}`
              : `${validator} has not run yet`;

      return { requirement, met: false, detail, remedy: "run the checks" };
    }

    const rank: Record<string, number> = { pass: 3, warn: 2, skipped: 1, fail: 0 };
    const required = rank[status] ?? 3;
    const worst = current.reduce((w, c) => (rank[c.status]! < rank[w.status]! ? c : w), current[0]!);
    if ((rank[worst.status] ?? 0) < required) {
      return {
        requirement, met: false,
        detail: `${validator}${formRole ? ` on ${formRole}` : ""}: ${worst.summary}`,
        remedy: worst.status === "fail" ? "fix this before releasing" : null,
      };
    }

    // A numeric bound reads the value the validator actually measured.
    if ((max !== undefined || min !== undefined) && field) {
      for (const check of current) {
        const value = check.detail[field];
        if (typeof value !== "number") {
          return {
            requirement, met: false,
            detail: `${validator} did not report a numeric "${field}"`, remedy: null,
          };
        }
        if (max !== undefined && value > max) {
          return {
            requirement, met: false,
            detail: `${field} is ${value.toLocaleString()}, over the limit of ${max.toLocaleString()}`,
            remedy: `reduce ${field}`,
          };
        }
        if (min !== undefined && value < min) {
          return {
            requirement, met: false,
            detail: `${field} is ${value.toLocaleString()}, under the required ${min.toLocaleString()}`,
            remedy: `increase ${field}`,
          };
        }
      }
    }

    return {
      requirement, met: true,
      detail: `${validator}${formRole ? ` on ${formRole}` : ""}: ${worst.summary}`,
      remedy: null,
    };
  }

  #checkFresh(objectId: string, requirement: Requirement): RequirementResult {
    const statuses = this.graph.recipes.statusOf(objectId);
    const notCurrent = statuses.filter((s) => s.state !== "fresh");

    if (statuses.length === 0) {
      // No recipe means nothing can be out of date; that is honest, not a free pass.
      return { requirement, met: true, detail: "nothing here is built from anything else", remedy: null };
    }
    if (notCurrent.length === 0) {
      return { requirement, met: true, detail: "everything is up to date", remedy: null };
    }
    const first = notCurrent[0]!;
    return {
      requirement, met: false,
      detail: notCurrent.length === 1
        ? `${first.stepKey} is ${first.state} — ${first.reason}`
        : `${notCurrent.length} steps are out of date, starting with ${first.stepKey} (${first.reason})`,
      remedy: notCurrent.some((s) => s.replayPolicy === "manual")
        ? "some of this is waiting on you"
        : "rebuild",
    };
  }

  #checkRelease(objectId: string, requirement: Extract<Requirement, { release: unknown }>): RequirementResult {
    const profile = this.get(requirement.release.profileId);
    const name = profile?.name ?? requirement.release.profileId;
    const state = this.graph.currentState(objectId);
    const all = this.releasesOf(objectId).filter((r) => r.profileId === requirement.release.profileId);

    // An approval is about the version it was given for. Letting any past release satisfy
    // a later version makes "released against X" permanently true after one approval.
    const forThisVersion = all.filter((r) => r.versionId === state?.versionId);
    if (forThisVersion.length > 0) {
      return { requirement, met: true, detail: `this version is released against ${name}`, remedy: null };
    }
    return {
      requirement, met: false,
      detail: all.length > 0
        ? `an earlier version was released against ${name}; this one has not been`
        : `not yet released against ${name}`,
      remedy: `approve ${name}`,
    };
  }

  #checksFor(objectId: string, validator: string): Check[] {
    return (this.graph.db.prepare(
      `SELECT * FROM checks WHERE object_id = ? AND validator = ? ORDER BY at DESC`,
    ).all(objectId, validator) as Array<Record<string, unknown>>).map((r) => ({
      id: r["id"] as string, objectId: r["object_id"] as string,
      representationId: (r["representation_id"] as string | null) ?? null,
      validator: r["validator"] as string, status: r["status"] as Check["status"],
      summary: r["summary"] as string,
      detail: JSON.parse((r["detail"] as string) || "{}") as Record<string, unknown>,
      formRole: (r["form_role"] as string | null) ?? null, at: r["at"] as number,
      subjectKind: (r["subject_kind"] as Check["subjectKind"]) ?? "unbound",
      subjectId: (r["subject_id"] as string | null) ?? null,
      subjectHash: (r["subject_hash"] as string | null) ?? null,
      validatorVersion: (r["validator_version"] as string) ?? "0.0.0",
      params: JSON.parse((r["params"] as string) || "{}") as Record<string, unknown>,
      environment: JSON.parse((r["environment"] as string) || "{}") as Record<string, unknown>,
      runId: (r["run_id"] as string | null) ?? null,
    }));
  }

  /* ---------------------------------------------------------------- releases */

  /**
   * Pins the current version against a profile, storing the readiness report exactly as it
   * stood. A release that cannot show why it was approved is not a release, it is a claim.
   */
  approve(input: {
    objectId: string; profileId: string; note?: string | null; force?: boolean;
    /** Accepted decisions this delivery was made under. Discovered from links when omitted. */
    decisionIds?: readonly string[];
  }): Release {
    const report = this.evaluate(input.objectId, input.profileId);
    if (!report) throw new Error(`no such profile: ${input.profileId}`);
    if (!report.ready && !input.force) {
      throw new NotReady(report.profileId, report.profileName, report.blockers.map((b) => b.detail));
    }
    const state = this.graph.currentState(input.objectId);
    if (!state) throw new Error(`no such object: ${input.objectId}`);

    // Bind the profile as it stood and the exact checks relied on, in one write. A later
    // edit to the profile cannot rewrite what was approved, and the evidence stays findable.
    const profile = this.get(input.profileId)!;
    const checkIds = report.results
      .flatMap((r) => this.#checkIdsBehind(input.objectId, r.requirement))
      .filter((id, i, all) => all.indexOf(id) === i);

    // Which accepted decisions this was made under. Recorded at approval rather than
    // recomputed later, so a delivery keeps answering the question after the decisions
    // themselves move on.
    const decisionIds = (input.decisionIds ?? this.#acceptedDecisionsBehind(input.objectId))
      .filter((id, i, all) => all.indexOf(id) === i);

    const release: Release = {
      id: newId(), objectId: input.objectId, versionId: state.versionId,
      profileId: input.profileId, decisionIds,
      profileHash: createHash("sha256").update(JSON.stringify(profile)).digest("hex"),
      checkIds,
      note: input.note ?? null,
      evidence: { ...report, forcedDespiteBlockers: !report.ready },
      approvedAt: now(),
    };
    this.graph.db.prepare(
      `INSERT INTO releases (id, object_id, version_id, profile_id, profile_hash, check_ids,
                             decision_ids, note, evidence, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(release.id, release.objectId, release.versionId, release.profileId,
          release.profileHash, JSON.stringify(release.checkIds),
          JSON.stringify(release.decisionIds),
          release.note, JSON.stringify(release.evidence), release.approvedAt);
    return release;
  }

  releasesOf(objectId: string): Release[] {
    return (this.graph.db.prepare(
      `SELECT * FROM releases WHERE object_id = ? ORDER BY approved_at DESC`,
    ).all(objectId) as Array<Record<string, unknown>>).map((r) => ({
      id: r["id"] as string, objectId: r["object_id"] as string,
      versionId: r["version_id"] as string, profileId: r["profile_id"] as string,
      profileHash: (r["profile_hash"] as string | null) ?? null,
      checkIds: JSON.parse((r["check_ids"] as string) || "[]") as string[],
      decisionIds: JSON.parse((r["decision_ids"] as string) || "[]") as string[],
      note: (r["note"] as string | null) ?? null,
      evidence: JSON.parse((r["evidence"] as string) || "{}") as Record<string, unknown>,
      approvedAt: r["approved_at"] as number,
    }));
  }

  /**
   * The accepted decisions an Object is linked to.
   *
   * Semantic links only: a decision is behind a delivery because somebody said so, never
   * because a file happened to pass through a step. Drafts and superseded decisions are
   * excluded — a delivery is made under what was accepted at the time.
   */
  #acceptedDecisionsBehind(objectId: string): string[] {
    return (this.graph.db.prepare(
      `SELECT DISTINCT d.object_id AS id FROM semantic_links l
       JOIN decisions d ON d.object_id = l.to_object_id OR d.object_id = l.from_object_id
       WHERE (l.from_object_id = ? OR l.to_object_id = ?)
         AND d.object_id != ?
         AND d.state IN ('accepted', 'needs_review')`,
    ).all(objectId, objectId, objectId) as Array<{ id: string }>).map((r) => r.id);
  }

  /**
   * The one check a requirement actually rested on, for the release record.
   *
   * Checks are append-only, so a validator that has run four times has four rows. Recording
   * all of them made a release claim four measurements where readiness had consulted one —
   * an overstatement of evidence in exactly the place this milestone exists to remove it.
   * Only the newest bound check counts, because that is the one readiness read.
   */
  #checkIdsBehind(objectId: string, requirement: Requirement): string[] {
    if (!has(requirement, "check")) return [];
    const { validator, formRole } = (requirement as Extract<Requirement, { check: unknown }>).check;
    const current = this.#checksFor(objectId, validator)
      .find((c) => c.subjectKind !== "unbound" && (!formRole || c.formRole === formRole));
    return current ? [current.id] : [];
  }
}
