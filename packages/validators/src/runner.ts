import type { Check, ObjectState } from "@xeniur/core";
import { newId, now } from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";
import { ideaDna, ingredientsOf } from "@xeniur/graph";
import type { ProviderEnv } from "@xeniur/providers";
import type { ObjectContext, Validator, ValidationSubject } from "./types.js";
import { meshValidators } from "./mesh.js";
import { imageValidators } from "./image.js";
import { mediaValidators } from "./media.js";
import { objectValidators } from "./object-level.js";

export const ALL_VALIDATORS: readonly Validator[] = [
  ...meshValidators, ...imageValidators, ...mediaValidators, ...objectValidators,
];

export interface ValidationSummary {
  objectId: string;
  checks: Check[];
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
}

/**
 * Runs every applicable validator over an Object's current forms and stores what they
 * measured.
 *
 * Checks are replaced per validator+form rather than appended, because a check is a
 * statement about what is true *now*. Keeping stale measurements around would let a
 * readiness profile pass on evidence about a form that no longer exists.
 */
export class ValidationRunner {
  /** Tool versions actually in use, recorded on every check this runner writes. */
  readonly #environment: Record<string, unknown>;

  constructor(
    private readonly graph: ObjectGraph,
    private readonly env: ProviderEnv,
    private readonly validators: readonly Validator[] = ALL_VALIDATORS,
    environment: Record<string, unknown> = {},
  ) {
    this.#environment = environment;
  }

  async validate(objectId: string, opts: { only?: readonly string[] } = {}): Promise<ValidationSummary> {
    const state = this.graph.currentState(objectId);
    if (!state) return { objectId, checks: [], passed: 0, warned: 0, failed: 0, skipped: 0 };

    const wanted = opts.only ? new Set(opts.only) : null;
    const written: Check[] = [];
    const runId = newId();   // groups this pass, so a whole validation can be cited

    for (const form of state.forms) {
      const representation = this.graph.getRepresentation(form.representationId);
      if (!representation?.blobHash) continue;

      const subject = this.#subjectFor(state, form.role, representation.id);
      if (!subject) continue;

      for (const validator of this.validators) {
        if (wanted && !wanted.has(validator.id)) continue;
        // Object-level validators speak about the whole Object, not this one form; they
        // run once, below, with the context they need.
        if (objectValidators.some((v) => v.id === validator.id)) continue;
        if (!validator.appliesTo(subject)) continue;

        const measured = {
          kind: "representation" as const,
          id: representation.id,
          hash: representation.blobHash,
        };
        try {
          const result = await validator.run(subject, this.env);
          written.push(this.#write(objectId, representation.id, form.role, validator, result, measured, runId));
        } catch (err) {
          written.push(this.#write(objectId, representation.id, form.role, validator, {
            status: "fail",
            summary: `the check could not run: ${err instanceof Error ? err.message : String(err)}`,
            detail: {},
          }, measured, runId));
        }
      }
    }

    // Object-level validators speak about the whole thing rather than one form, so they
    // are given a view of what the Object was built from instead of a single blob.
    const first = state.forms[0];
    const objectSubject = first
      ? this.#subjectFor(state, first.role, first.representationId, this.#objectContext(objectId))
      : null;

    if (objectSubject) {
      for (const validator of objectValidators) {
        if (wanted && !wanted.has(validator.id)) continue;
        if (!this.validators.some((v) => v.id === validator.id)) continue;
        // An object-level validator speaks about the version, not one representation.
        const measured = {
          kind: "object_version" as const, id: state.versionId, hash: null,
        };
        try {
          const result = await validator.run(objectSubject, this.env);
          written.push(this.#write(objectId, null, null, validator, result, measured, runId));
        } catch (err) {
          written.push(this.#write(objectId, null, null, validator, {
            status: "fail",
            summary: `the check could not run: ${err instanceof Error ? err.message : String(err)}`,
            detail: {},
          }, measured, runId));
        }
      }
    }

    const count = (s: Check["status"]) => written.filter((c) => c.status === s).length;
    return {
      objectId, checks: written,
      passed: count("pass"), warned: count("warn"), failed: count("fail"), skipped: count("skipped"),
    };
  }

  #objectContext(objectId: string): ObjectContext {
    return {
      ingredients: () => ingredientsOf(this.graph, objectId),
      dna: () => ideaDna(this.graph, { objectId }),
      provenances: () => {
        const state = this.graph.currentState(objectId);
        return (state?.forms ?? [])
          .map((f) => this.graph.getRepresentation(f.representationId)?.provenance)
          .filter((p): p is NonNullable<typeof p> => p !== undefined);
      },
      previousRootSets: () => {
        // Every earlier release of this Object, by the roots it was built from.
        const rows = this.graph.db.prepare(
          `SELECT version_id FROM releases WHERE object_id = ? ORDER BY approved_at DESC LIMIT 20`,
        ).all(objectId) as Array<{ version_id: string }>;
        return rows.map((r) => {
          const forms = this.graph.formsAt(r.version_id);
          const roots = new Set<string>();
          for (const f of forms) {
            for (const step of this.graph.ancestryOf(f.representationId)) {
              if (this.graph.edgesInto(step.representationId).length === 0) roots.add(step.representationId);
            }
          }
          return [...roots];
        });
      },
    };
  }

  #subjectFor(
    state: ObjectState, role: string, representationId: string, object?: ObjectContext,
  ): ValidationSubject | null {
    const representation = this.graph.getRepresentation(representationId);
    if (!representation) return null;
    let bytes: Buffer | null = null;
    return {
      representation, formRole: role, properties: state.properties,
      ...(object ? { object } : {}),
      bytes: () => {
        if (!bytes) {
          if (!representation.blobHash) throw new Error("this form has no stored bytes");
          bytes = this.graph.readBlob(representation.blobHash);
        }
        return bytes;
      },
    };
  }

  #write(
    objectId: string, representationId: string | null, formRole: string | null,
    validator: Validator, result: { status: Check["status"]; summary: string; detail: Record<string, unknown> },
    subject: { kind: Check["subjectKind"]; id: string | null; hash: string | null },
    runId: string,
  ): Check {
    // Append-only. Nothing is deleted: a check is a statement about what was true of a
    // particular representation at a particular moment, and deleting it would erase the
    // record that a now-superseded form was once measured. Readiness selects the current
    // one by subject, not by recency alone.
    const check: Check = {
      id: newId(), objectId, representationId, validator: validator.id, status: result.status,
      summary: result.summary, detail: result.detail, formRole, at: now(),
      subjectKind: subject.kind, subjectId: subject.id, subjectHash: subject.hash,
      validatorVersion: validator.version ?? "1.0.0",
      params: {}, environment: this.#environment, runId,
    };
    this.graph.db.prepare(
      `INSERT INTO checks (id, object_id, representation_id, validator, status, summary,
                           detail, form_role, at, subject_kind, subject_id, subject_hash,
                           validator_version, params, environment, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(check.id, objectId, representationId, validator.id, check.status, check.summary,
          JSON.stringify(check.detail), formRole, check.at,
          check.subjectKind, check.subjectId, check.subjectHash,
          check.validatorVersion, JSON.stringify(check.params),
          JSON.stringify(check.environment), runId);
    return check;
  }
}
