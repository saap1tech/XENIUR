import type {
  ObjectState, Recipe, RecipeStep, RecipeStepDraft, RebuildPlan, StepState, StepStatus, Tool,
} from "@xeniur/core";
import { newId, now } from "@xeniur/core";
import { json, type Db } from "./db.js";
import {
  assertValidRecipe, capabilityVersionFor, fingerprintStep, parseRef, statusFor,
  stepPublishesRoles, topoOrder, upstreamOf, worstState,
} from "./recipes.js";

interface RecipeRow {
  id: string; object_id: string; name: string; revision: number;
  parent_recipe_id: string | null; enabled: number; created_at: number;
}
interface StepRow {
  id: string; recipe_id: string; key: string; tool: string; capability_version: string;
  args: string; replay_policy: string; position: number; created_at: number;
}
interface InputRow {
  step_id: string; slot: string; source_kind: string; source_ref: string;
  accepts: string; required: number;
}
interface OutputRow {
  step_id: string; slot: string; modality: string; format: string; form_role: string | null;
}
interface DerivationRow {
  representation_id: string; recipe_id: string; step_key: string;
  input_fingerprint: string; capability_version: string; built_at: number;
}

export interface CandidateRow {
  id: string; objectId: string; representationId: string; formRole: string;
  recipeId: string | null; stepKey: string | null;
  status: "pending" | "accepted" | "rejected"; createdAt: number; decidedAt: number | null;
}

/**
 * Storage and staleness for recipe DAGs.
 *
 * Nothing here polls or caches: a step's state is recomputed from the graph on read, so it
 * cannot drift out of sync with reality the way a stored `is_stale` column always does.
 */
export class RecipeStore {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      currentState(objectId: string): ObjectState | null;
      blobHashOf(representationId: string): string | null;
    },
  ) {}

  /* ------------------------------------------------------------- writing */

  /**
   * Saves a new revision. Recipes are never edited in place — the recipe that built a past
   * release has to stay readable, so editing produces revision n+1 and the caller pins it
   * onto a new object version.
   */
  saveRecipe(input: { objectId: string; name: string; steps: readonly RecipeStepDraft[] }): Recipe {
    assertValidRecipe(input.steps);

    return this.db.transaction(() => {
      const previous = this.db.prepare(
        `SELECT * FROM recipes WHERE object_id = ? AND name = ? ORDER BY revision DESC LIMIT 1`,
      ).get(input.objectId, input.name) as RecipeRow | undefined;

      const recipeId = newId();
      const revision = (previous?.revision ?? -1) + 1;
      const at = now();
      this.db.prepare(
        `INSERT INTO recipes (id, object_id, name, revision, parent_recipe_id, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      ).run(recipeId, input.objectId, input.name, revision, previous?.id ?? null, at);

      const insStep = this.db.prepare(
        `INSERT INTO recipe_steps (id, recipe_id, key, tool, capability_version, args,
                                   replay_policy, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insIn = this.db.prepare(
        `INSERT INTO recipe_step_inputs (step_id, slot, source_kind, source_ref, accepts, required)
         VALUES (?, ?, ?, ?, ?, ?)`);
      const insOut = this.db.prepare(
        `INSERT INTO recipe_step_outputs (step_id, slot, modality, format, form_role)
         VALUES (?, ?, ?, ?, ?)`);

      input.steps.forEach((step, position) => {
        const stepId = newId();
        insStep.run(stepId, recipeId, step.key, step.tool,
          step.capabilityVersion ?? capabilityVersionFor(step.tool),
          json.stringify(step.args ?? {}), step.replayPolicy, position, at);
        for (const i of step.inputs ?? []) {
          insIn.run(stepId, i.slot, i.sourceKind, i.sourceRef, json.stringify(i.accepts ?? {}), i.required ? 1 : 0);
        }
        for (const o of step.outputs ?? []) {
          insOut.run(stepId, o.slot, o.modality, o.format, o.formRole ?? null);
        }
      });

      const saved = this.getRecipe(recipeId);
      if (!saved) throw new Error("recipe vanished immediately after being written");
      return saved;
    })();
  }

  getRecipe(id: string): Recipe | null {
    const r = this.db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(id) as RecipeRow | undefined;
    if (!r) return null;

    const steps = (this.db.prepare(
      `SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY position, rowid`,
    ).all(id) as StepRow[]).map((s): RecipeStep => ({
      id: s.id, recipeId: s.recipe_id, key: s.key, tool: s.tool as Tool,
      capabilityVersion: s.capability_version,
      args: json.parse<Record<string, unknown>>(s.args, {}),
      replayPolicy: s.replay_policy as RecipeStep["replayPolicy"],
      inputs: (this.db.prepare(`SELECT * FROM recipe_step_inputs WHERE step_id = ? ORDER BY slot`)
        .all(s.id) as InputRow[]).map((i) => ({
          slot: i.slot, sourceKind: i.source_kind as "form" | "step" | "decision",
          sourceRef: i.source_ref,
          accepts: json.parse(i.accepts, {}), required: i.required === 1,
        })),
      outputs: (this.db.prepare(`SELECT * FROM recipe_step_outputs WHERE step_id = ? ORDER BY slot`)
        .all(s.id) as OutputRow[]).map((o) => ({
          slot: o.slot, modality: o.modality as RecipeStep["outputs"][number]["modality"],
          format: o.format, formRole: o.form_role,
        })),
    }));

    return {
      id: r.id, objectId: r.object_id, name: r.name, revision: r.revision,
      parentRecipeId: r.parent_recipe_id, enabled: r.enabled === 1, createdAt: r.created_at, steps,
    };
  }

  /** Every revision of every recipe on an Object, newest first. */
  listRecipes(objectId: string): Recipe[] {
    return (this.db.prepare(
      `SELECT id FROM recipes WHERE object_id = ? ORDER BY name, revision DESC`,
    ).all(objectId) as Array<{ id: string }>)
      .map((r) => this.getRecipe(r.id))
      .filter((r): r is Recipe => r !== null);
  }

  /** The revision pinned by the Object's current version — not merely the newest. */
  recipeAtCurrentVersion(objectId: string): Recipe | null {
    const state = this.deps.currentState(objectId);
    return state?.recipeId ? this.getRecipe(state.recipeId) : null;
  }

  recordDerivation(input: {
    representationId: string; recipeId: string; stepKey: string;
    fingerprint: string; capabilityVersion: string;
  }): void {
    this.db.prepare(
      `INSERT INTO derivations (representation_id, recipe_id, step_key, input_fingerprint,
                                capability_version, built_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(representation_id) DO UPDATE SET
         recipe_id = excluded.recipe_id, step_key = excluded.step_key,
         input_fingerprint = excluded.input_fingerprint,
         capability_version = excluded.capability_version, built_at = excluded.built_at`,
    ).run(input.representationId, input.recipeId, input.stepKey, input.fingerprint,
          input.capabilityVersion, now());
  }

  derivationOf(representationId: string): DerivationRow | null {
    return (this.db.prepare(`SELECT * FROM derivations WHERE representation_id = ?`)
      .get(representationId) as DerivationRow | undefined) ?? null;
  }

  /**
   * The bytes of a Decision's brief at the version that was accepted.
   *
   * Null while the decision is still a draft, which makes any step depending on it
   * unresolvable rather than silently building against a half-made choice.
   */
  #acceptedBriefHash(decisionObjectId: string): string | null {
    const row = this.db.prepare(
      `SELECT r.blob_hash AS hash
       FROM decisions d
       JOIN version_forms vf ON vf.version_id = d.accepted_version_id AND vf.role = 'decision.brief'
       JOIN representations r ON r.id = vf.representation_id
       WHERE d.object_id = ? AND d.state IN ('accepted', 'needs_review')`,
    ).get(decisionObjectId) as { hash: string | null } | undefined;
    return row?.hash ?? null;
  }

  /* ---------------------------------------------------------- candidates */

  /** A generated rebuild parks here instead of overwriting a form someone chose. */
  addCandidate(input: {
    objectId: string; representationId: string; formRole: string;
    recipeId?: string | null; stepKey?: string | null;
  }): string {
    const id = newId();
    this.db.prepare(
      `INSERT INTO candidates (id, object_id, representation_id, form_role, recipe_id,
                               step_key, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
    ).run(id, input.objectId, input.representationId, input.formRole,
          input.recipeId ?? null, input.stepKey ?? null, now());
    return id;
  }

  pendingCandidates(objectId: string): CandidateRow[] {
    return (this.db.prepare(
      `SELECT * FROM candidates WHERE object_id = ? AND status = 'pending' ORDER BY created_at`,
    ).all(objectId) as Array<Record<string, never>>).map((r) => {
      const row = r as unknown as {
        id: string; object_id: string; representation_id: string; form_role: string;
        recipe_id: string | null; step_key: string | null; status: CandidateRow["status"];
        created_at: number; decided_at: number | null;
      };
      return {
        id: row.id, objectId: row.object_id, representationId: row.representation_id,
        formRole: row.form_role, recipeId: row.recipe_id, stepKey: row.step_key,
        status: row.status, createdAt: row.created_at, decidedAt: row.decided_at,
      };
    });
  }

  decideCandidate(id: string, decision: "accepted" | "rejected"): CandidateRow | null {
    this.db.prepare(`UPDATE candidates SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`)
      .run(decision, now(), id);
    const row = this.db.prepare(`SELECT * FROM candidates WHERE id = ?`).get(id) as {
      id: string; object_id: string; representation_id: string; form_role: string;
      recipe_id: string | null; step_key: string | null; status: CandidateRow["status"];
      created_at: number; decided_at: number | null;
    } | undefined;
    return row ? {
      id: row.id, objectId: row.object_id, representationId: row.representation_id,
      formRole: row.form_role, recipeId: row.recipe_id, stepKey: row.step_key,
      status: row.status, createdAt: row.created_at, decidedAt: row.decided_at,
    } : null;
  }

  /* ------------------------------------------------------------ staleness */

  /**
   * Recomputes every step's state from the graph.
   *
   * Resolution is done in dependency order so a step can see what its upstream produced —
   * and so a pending manual step marks everything behind it `blocked` rather than letting
   * it quietly rebuild onto a source the person has already moved past.
   */
  statusOf(objectId: string): StepStatus[] {
    const recipe = this.recipeAtCurrentVersion(objectId);
    const state = this.deps.currentState(objectId);
    if (!recipe || !state) return [];

    const formHash = new Map<string, string | null>();
    for (const f of state.forms) formHash.set(f.role, this.deps.blobHashOf(f.representationId));

    const supersededRoles = new Set(this.pendingCandidates(objectId).map((c) => c.formRole));
    const byKey = new Map<string, StepStatus>();
    /** What each step's output slots resolved to, for downstream steps to consume. */
    const produced = new Map<string, string | null>();
    const out: StepStatus[] = [];

    for (const step of topoOrder(recipe.steps)) {
      const upstreamStates = upstreamOf(step)
        .map((k) => byKey.get(k)?.state)
        .filter((s): s is StepState => s !== undefined);

      const hashes: string[] = [];
      let unresolved: string | null = null;

      for (const input of step.inputs) {
        let hash: string | null | undefined;
        if (input.sourceKind === "form") {
          hash = formHash.get(input.sourceRef);
          if (hash === undefined && input.required) unresolved = `no "${input.sourceRef}" form exists yet`;
        } else if (input.sourceKind === "decision") {
          // The brief as accepted, never as currently drafted: a build is made under what
          // somebody signed off, and an unaccepted edit must not change a built asset.
          hash = this.#acceptedBriefHash(input.sourceRef);
          if (hash === null && input.required) {
            unresolved = "the decision this depends on has not been accepted yet";
          }
        } else {
          const ref = parseRef(input.sourceRef);
          hash = ref ? produced.get(`${ref.key}.${ref.slot}`) : undefined;
          if (hash === undefined && input.required) unresolved = `"${input.sourceRef}" has not been built`;
        }
        if (typeof hash === "string") hashes.push(hash);
      }

      const fingerprint = fingerprintStep({
        tool: step.tool, capabilityVersion: step.capabilityVersion,
        args: step.args, inputHashes: hashes,
      });

      // What this step published, if anything, and what it was built from.
      const roles = stepPublishesRoles(step);
      const publishedRep = roles
        .map((role) => state.forms.find((f) => f.role === role)?.representationId)
        .find((id): id is string => id !== undefined);
      const derivation = publishedRep ? this.derivationOf(publishedRep) : null;

      for (const o of step.outputs) {
        const role = o.formRole;
        produced.set(`${step.key}.${o.slot}`,
          role ? formHash.get(role) ?? null : (publishedRep ? formHash.get(roles[0]!) ?? null : null));
      }

      let status: StepStatus;
      if (unresolved) {
        status = statusFor(step, "unresolvable", unresolved, fingerprint, derivation?.input_fingerprint ?? null);
      } else if (roles.some((r) => supersededRoles.has(r))) {
        status = statusFor(step, "superseded", "a generated candidate is waiting for you to accept or reject it",
          fingerprint, derivation?.input_fingerprint ?? null);
      } else if (!derivation) {
        status = statusFor(step, "never_built", "this has not been produced yet", fingerprint, null);
      } else if (derivation.input_fingerprint !== fingerprint) {
        const why = derivation.capability_version !== step.capabilityVersion
          ? `${step.tool} changed from ${derivation.capability_version} to ${step.capabilityVersion}`
          : "its inputs or settings changed";
        status = statusFor(step, "stale", why, fingerprint, derivation.input_fingerprint);
      } else {
        status = statusFor(step, "fresh", "up to date", fingerprint, derivation.input_fingerprint);
      }

      // If anything upstream is going to be rebuilt, this step's input is going to change
      // too, so it is already out of date — saying otherwise would report a clean rebuild
      // while leaving a thumbnail derived from an image that no longer exists.
      if (status.state === "fresh" &&
          upstreamStates.some((u) => u === "stale" || u === "never_built")) {
        status = statusFor(step, "stale", "an earlier step will be rebuilt first",
          status.fingerprint, status.builtFingerprint);
      }

      // Anything behind a pending manual step would bake in a source the person has
      // already moved past — including a step that has never been built at all, which is
      // just as wrong to run as one that is merely out of date.
      if (status.state === "fresh" || status.state === "stale" || status.state === "never_built") {
        const upstream = worstState(upstreamStates);
        if (upstream === "blocked" || upstream === "unresolvable") {
          status = statusFor(step, "blocked", "waiting on an earlier step", status.fingerprint, status.builtFingerprint);
        } else if (this.#upstreamManualPending(recipe.steps, step, byKey)) {
          status = statusFor(step, "blocked", "an earlier step is waiting on you",
            status.fingerprint, status.builtFingerprint);
        }
      }

      byKey.set(step.key, status);
      out.push(status);
    }
    return out;
  }

  #upstreamManualPending(
    steps: readonly RecipeStep[], step: RecipeStep, byKey: Map<string, StepStatus>,
  ): boolean {
    const stepsByKey = new Map(steps.map((s) => [s.key, s]));
    const seen = new Set<string>();
    const walk = (key: string): boolean => {
      if (seen.has(key)) return false;
      seen.add(key);
      const s = stepsByKey.get(key);
      const status = byKey.get(key);
      if (!s || !status) return false;
      if (s.replayPolicy === "manual" && status.state !== "fresh") return true;
      return upstreamOf(s).some(walk);
    };
    return upstreamOf(step).some(walk);
  }

  /**
   * The rebuild preview: three honest buckets rather than a progress bar.
   *
   * `willRebuild` runs for free and produces identical bytes. `canRegenerate` costs money
   * and produces something *different*, so it yields a candidate. `waitingOnYou` cannot be
   * performed by XENIUR at all.
   */
  planRebuild(objectId: string, costOf: (tool: Tool) => number = () => 0): RebuildPlan {
    const recipe = this.recipeAtCurrentVersion(objectId);
    const statuses = this.statusOf(objectId);
    const needsWork = (s: StepStatus) => s.state === "stale" || s.state === "never_built";

    const willRebuild = statuses.filter((s) => s.replayPolicy === "deterministic" && needsWork(s));
    const canRegenerate = statuses.filter((s) => s.replayPolicy === "candidate_generation" &&
      (needsWork(s) || s.state === "superseded"));
    const waitingOnYou = statuses.filter((s) => s.replayPolicy === "manual" && needsWork(s));
    const blocked = statuses.filter((s) => s.state === "blocked" || s.state === "unresolvable");
    const fresh = statuses.filter((s) => s.state === "fresh");

    return {
      objectId, recipeId: recipe?.id ?? null,
      willRebuild, canRegenerate, waitingOnYou, blocked, fresh,
      estimatedUsd: canRegenerate.reduce((sum, s) => sum + costOf(s.tool), 0),
    };
  }
}
