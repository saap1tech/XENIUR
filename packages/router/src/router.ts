import type {
  ActionPlan, ActionRecord, Capability, Cost, InputRole, ObjectState, Representation, Tool,
} from "@xeniur/core";
import type { Authorization, SemanticRelation, StaleBaseVersion } from "@xeniur/core";
import {
  BudgetExceeded, CapabilityUnavailable, TOOL_SPECS, addCost, specOf, zeroCost,
} from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";
import type { PermissionBroker } from "@xeniur/permissions";
import type { Provider, ProviderEnv, ProviderInput, ProvidersConfig } from "@xeniur/providers";
import { ProviderRegistry } from "@xeniur/providers";

export interface RouterDeps {
  graph: ObjectGraph;
  broker: PermissionBroker;
  registry?: ProviderRegistry;
  config: ProvidersConfig;
  env: ProviderEnv;
  computeGate?: {
    reserve(plan: ActionPlan, ctx: ExecuteContext, provider: Provider): void;
    settle(quoteId: string, actualUsd: number): void;
  };
}

export interface ExecuteContext {
  worldId: string;
  /** Which Object form role each output fills, index-aligned with the provider outputs. */
  formRoles?: readonly (string | null)[];
  taskId?: string | null;
  /** Permission for exactly this action, bound to its plan digest. */
  authorization?: Authorization;
  computeQuoteId?: string;
  /** True when the reason for this action came from content XENIUR does not control. */
  derivedFromUntrusted?: boolean;
  /** Representations to feed in, with the role each one plays. */
  inputs?: ReadonlyArray<{ representationId: string; role: InputRole }>;
  /** Attach outputs to this object. Defaults to the plan's first object. */
  objectId?: string;
  label?: string;
  /**
   * The version this work was planned against. Defaults to whatever is current when the
   * provider is dispatched, which is what catches an edit made while a long job runs.
   */
  expectedBaseVersionId?: string | null;
}

export interface ExecutionResult {
  action: ActionRecord;
  objectId: string;
  representations: Representation[];
  /** The Object's resolved state after the commit — properties and every current form. */
  state: ObjectState | null;
  provider: string;
  cost: Cost;
  /**
   * Set when the Object moved on while this ran. The outputs exist and are inspectable,
   * but nothing was published over the newer work.
   */
  conflict: StaleBaseVersion | null;
}

export interface Routing { provider: Provider; reason: string; }

/**
 * The Capability Router — the only path from a decision to the outside world.
 *
 * It exists to make one rule structural rather than aspirational:
 *
 *     deterministic first -> cheap model second -> expensive generation last
 *
 * Moving an object is local code. Resizing an image is sharp. Rescaling a mesh is
 * Blender. Cutting video is FFmpeg. Only pixels, geometry or frames that genuinely do
 * not exist yet are worth a generative call — and the router refuses to make one for a
 * tool that the tool table says never needs to leave the machine.
 */
export class CapabilityRouter {
  private readonly graph: ObjectGraph;
  private readonly broker: PermissionBroker;
  private readonly registry: ProviderRegistry;
  private readonly config: ProvidersConfig;
  private readonly env: ProviderEnv;
  private readonly computeGate: RouterDeps["computeGate"];

  constructor(deps: RouterDeps) {
    this.graph = deps.graph;
    this.broker = deps.broker;
    this.registry = deps.registry ?? new ProviderRegistry();
    this.config = deps.config;
    this.env = deps.env;
    this.computeGate = deps.computeGate;
  }

  /* ------------------------------------------------------- the eight verbs */
  /* No UI or project data ever names a provider; it names one of these.      */

  think(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("doc.write", args, ctx); }
  image(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("image.generate", args, ctx); }
  video(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("video.generate", args, ctx); }
  to3D(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("3d.generate", args, ctx); }
  code(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("code.scaffold", args, ctx); }
  browser(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("browser.open", args, ctx); }
  transform(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("image.transform", args, ctx); }
  export(args: Record<string, unknown>, ctx: ExecuteContext) { return this.run("3d.export", args, ctx); }

  private run(tool: Tool, args: Record<string, unknown>, ctx: ExecuteContext) {
    return this.execute({ intent: tool, objects: ctx.objectId ? [ctx.objectId] : [], tool, args, confirmation: false }, ctx);
  }

  /* -------------------------------------------------------------- dispatch */

  /**
   * Picks the first configured provider that supports the tool and is actually usable.
   * Order comes from config, so a provider can be swapped on price or quality without
   * touching code — but the routing rule below is enforced here regardless of config.
   */
  async route(tool: Tool): Promise<Routing> {
    const capability: Capability = specOf(tool).capability;
    const order = this.config.capabilities[capability]?.order ?? [];
    const tried: string[] = [];

    for (const id of order) {
      const provider = this.registry.get(id);
      if (!provider || !provider.tools.includes(tool)) continue;
      this.assertRoutingRule(tool, provider);

      const state = await provider.available(this.env);
      if (state.ok) {
        return { provider, reason: tried.length === 0 ? `${id} is the preferred provider` : `${id} after ${tried.join(", ")} were unavailable` };
      }
      tried.push(`${id} (${state.reason})`);
    }

    const detail = tried.length > 0 ? tried.join("; ") : `nothing in config supports ${tool}`;
    throw new CapabilityUnavailable(tool, detail);
  }

  /**
   * A tool the tool table marks as never needing to leave the machine must never be
   * served by a generative provider, whatever the config says. Resizing an image through
   * an image model is the expensive way to get a worse result.
   */
  private assertRoutingRule(tool: Tool, provider: Provider): void {
    if (!specOf(tool).external && provider.kind === "generative") {
      throw new Error(
        `routing rule violated: ${tool} is deterministic, but config routes it to the ` +
        `generative provider "${provider.id}"`,
      );
    }
  }

  private assertWithinBudget(estimateUsd: number, taskId: string | null): void {
    const { perActionUsdMax, perTaskUsdMax, totalUsdMax } = this.config.budget;
    if (estimateUsd > perActionUsdMax) throw new BudgetExceeded("perActionUsdMax", estimateUsd, perActionUsdMax);

    const sum = (sql: string, ...params: unknown[]): number => {
      const rows = this.graph.db.prepare(sql).all(...params) as Array<{ cost: string }>;
      return rows.reduce((acc, r) => {
        try { return acc + ((JSON.parse(r.cost) as Cost).usd ?? 0); } catch { return acc; }
      }, 0);
    };

    if (taskId) {
      const spent = sum(`SELECT cost FROM actions WHERE task_id = ?`, taskId);
      if (spent + estimateUsd > perTaskUsdMax) throw new BudgetExceeded("perTaskUsdMax", spent + estimateUsd, perTaskUsdMax);
    }
    const total = sum(`SELECT cost FROM actions`);
    if (total + estimateUsd > totalUsdMax) throw new BudgetExceeded("totalUsdMax", total + estimateUsd, totalUsdMax);
  }

  /* --------------------------------------------------------------- execute */

  /**
   * The full path for one Action Plan: permission gate, provider selection, execution,
   * then lineage. Every branch that produces a representation goes through here, which
   * is why nothing in XENIUR can produce an unattributed one.
   */
  async execute(plan: ActionPlan, ctx: ExecuteContext): Promise<ExecutionResult> {
    // 1. The deterministic gate. Throws ApprovalRequired for anything consequential,
    //    which parks the task rather than failing it.
    const decision = this.broker.guard({
      tool: plan.tool, args: plan.args, scope: this.scopeOf(plan),
      objectId: ctx.objectId ?? plan.objects[0],
      // The plan travels with the request so the Broker recomputes the digest rather than
      // trusting a caller's claim that something was approved.
      plan: {
        tool: plan.tool, args: plan.args,
        objectId: ctx.objectId ?? plan.objects[0] ?? null,
        inputs: ctx.inputs ?? [],
        destination: this.scopeOf(plan),
      },
      ...(ctx.authorization ? { authorization: ctx.authorization } : {}),
      derivedFromUntrusted: ctx.derivedFromUntrusted ?? false,
    });

    // 2. Object-level tools are local code and need no provider at all.
    if (plan.tool === "object.create" || plan.tool === "object.update" || plan.tool === "object.move") {
      return this.executeLocalObjectTool(plan, ctx, decision.level);
    }

    const objectId = ctx.objectId ?? plan.objects[0];
    if (!objectId) throw new Error(`${plan.tool} needs an object to attach its output to`);

    const { provider, reason } = await this.route(plan.tool);
    this.assertWithinBudget(this.estimateUsd(provider), ctx.taskId ?? null);

    const inputs = this.resolveInputs(ctx.inputs ?? []);
    if (provider.kind === "generative" || ctx.computeQuoteId) {
      if (!this.computeGate || !ctx.computeQuoteId) throw new Error("Review the Compute estimate before cloud generation.");
      this.computeGate.reserve(plan, ctx, provider);
    }
    const action = this.graph.beginAction({
      worldId: ctx.worldId, taskId: ctx.taskId ?? null, intent: plan.intent, tool: plan.tool,
      plan, permissionLevel: decision.level,
      provenance: provider.kind === "mock" ? "mock" : provider.kind === "generative" ? "generated" : "deterministic",
      provider: provider.id, generationParams: { ...plan.args, routing: reason },
    });

    // Captured immediately before dispatch: anything that changes the head from here on
    // happened *during* this job, and is the person's newer intent, not this job's base.
    const baseVersionId = ctx.expectedBaseVersionId !== undefined
      ? ctx.expectedBaseVersionId
      : (this.graph.currentState(objectId)?.versionId ?? null);

    try {
      const result = await provider.execute({ tool: plan.tool, args: plan.args, inputs }, this.env);
      if (ctx.computeQuoteId) this.computeGate!.settle(ctx.computeQuoteId, result.cost.usd);

      // One transaction: representations, lineage, the action's closing row and the
      // version snapshot land together or not at all.
      const committed = this.graph.commitResult({
        actionId: action.id, objectId,
        representations: result.outputs.map((out) => ({
          objectId, modality: out.modality, format: out.format,
          blobHash: this.graph.putBlob(out.data, out.mime, out.ext),
          producedByActionId: action.id, provenance: result.provenance,
          provider: provider.id, model: result.model, toolVersion: result.toolVersion,
          generationParams: result.generationParams,
        })),
        // An explicit null means "publish to no form role" — a candidate must not become
        // the current form. `?? default` would treat that null as "unspecified" and
        // overwrite the very thing the person chose, so presence is checked, not nullness.
        formRoles: result.outputs.map((_, i) =>
          ctx.formRoles && i < ctx.formRoles.length
            ? ctx.formRoles[i]!
            : (i === 0 ? defaultFormRole(plan.tool) : null)),
        inputs: (ctx.inputs ?? []).map((i) => ({ representationId: i.representationId, role: i.role })),
        cost: result.cost, model: result.model, toolVersion: result.toolVersion,
        label: ctx.label ?? plan.intent,
        expectedBaseVersionId: baseVersionId,
      });

      return {
        action: committed.action, objectId, representations: committed.representations,
        state: committed.state, provider: provider.id, cost: result.cost,
        conflict: committed.conflict,
      };
    } catch (err) {
      this.graph.failAction(action.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** Local, reversible, free. No provider is consulted and nothing leaves the machine. */
  private executeLocalObjectTool(
    plan: ActionPlan, ctx: ExecuteContext, level: ExecutionResult["action"]["permissionLevel"],
  ): ExecutionResult {
    const action = this.graph.beginAction({
      worldId: ctx.worldId, taskId: ctx.taskId ?? null, intent: plan.intent, tool: plan.tool,
      plan, permissionLevel: level, provenance: "deterministic",
      provider: "local.graph", model: null, toolVersion: "xeniur graph 0.1.0",
      generationParams: plan.args,
    });

    let state: ObjectState;
    if (plan.tool === "object.create") {
      state = this.graph.createObject({
        worldId: ctx.worldId,
        semanticType: String(plan.args["semanticType"] ?? "object"),
        title: String(plan.args["title"] ?? "Untitled"),
      });
    } else {
      const objectId = ctx.objectId ?? plan.objects[0] ?? "";
      if (!objectId) throw new Error(`${plan.tool} needs an object`);
      const current = this.graph.currentState(objectId);
      if (!current) throw new Error(`no such object: ${objectId}`);

      // A gesture's outcome, applied. These were proposed by a drop and chosen by the person;
      // this is the one route that lands them, and it lands them here rather than as an
      // empty version. Each is recorded against the action like any other change.
      const operation = plan.args["operation"];
      if (operation === "semantic_link") {
        this.graph.decisions.link({
          fromObjectId: String(plan.args["fromObjectId"]), toObjectId: String(plan.args["toObjectId"]),
          relation: plan.args["relation"] as SemanticRelation, note: String(plan.args["note"] ?? ""),
        });
        state = current;
      } else if (operation === "composition") {
        this.graph.db.prepare(`UPDATE objects SET parent_id = ? WHERE id = ?`)
          .run(String(plan.args["toObjectId"]), String(plan.args["fromObjectId"]));
        state = this.graph.currentState(objectId) ?? current;
      } else if (operation === "decision_option") {
        // An alternative laid beside a decision becomes one of its options, unchosen.
        const decision = this.graph.decisions.detail(String(plan.args["decisionId"]));
        if (!decision) throw new Error("that decision is no longer here");
        const key = String(plan.args["key"] ?? plan.args["label"]).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
        if (!decision.options.some((o) => o.key === key)) {
          this.graph.decisions.update(decision.objectId, {
            options: [...decision.options.map((o) => ({ key: o.key, label: o.label, note: o.note })),
              { key, label: String(plan.args["label"]), note: String(plan.args["note"] ?? "") }],
          });
        }
        state = current;
      } else if (operation === "next_action") {
        // A question dropped on the Work zone becomes a next action on the World's goal.
        const goal = this.graph.goals.current(ctx.worldId);
        if (!goal) throw new Error("this World has no goal to add a next action to");
        this.graph.goals.addNextAction(goal.id, { text: String(plan.args["text"]), objectId: String(plan.args["questionId"]) });
        state = current;
      } else {
        // Property edits commit a version like anything else — that is what keeps a rename
        // or a move inside Undo instead of quietly outside it.
        const patch: Record<string, unknown> = {};
        if (typeof plan.args["title"] === "string") patch["title"] = plan.args["title"];
        if (typeof plan.args["semanticType"] === "string") patch["semanticType"] = plan.args["semanticType"];
        if (plan.tool === "object.move") {
          patch["settings"] = { ...current.properties.settings, x: plan.args["x"], y: plan.args["y"] };
        }
        state = this.graph.commitVersion({
          objectId, properties: patch, causeActionId: action.id, label: plan.intent,
        });
      }
    }

    const completed = this.graph.completeAction(action.id, { cost: zeroCost() });
    this.graph.db.prepare(`UPDATE actions SET tool_version = ? WHERE id = ?`)
      .run("xeniur graph 0.1.0", action.id);
    return {
      action: this.graph.getAction(action.id) ?? completed,
      objectId: state.object.id, representations: [], state,
      provider: "local.graph", cost: zeroCost(), conflict: null,
    };
  }

  private resolveInputs(refs: ReadonlyArray<{ representationId: string; role: InputRole }>): ProviderInput[] {
    return refs.map(({ representationId, role }) => {
      const rep = this.graph.getRepresentation(representationId);
      if (!rep) throw new Error(`no such representation: ${representationId}`);
      if (!rep.blobHash) throw new Error(`representation ${representationId} has no stored bytes`);
      return {
        representationId, role, modality: rep.modality, format: rep.format,
        data: this.graph.readBlob(rep.blobHash),
      };
    });
  }

  /** A domain is the natural scope for a remembered decision; otherwise the tool itself. */
  private scopeOf(plan: ActionPlan): string {
    const domain = plan.args["domain"];
    if (typeof domain === "string" && domain !== "") return domain;
    const url = plan.args["url"];
    if (typeof url === "string") { try { return new URL(url).hostname; } catch { /* not a url */ } }
    return plan.tool;
  }

  private estimateUsd(provider: Provider): number {
    if (provider.kind !== "generative") return 0;
    const entry = this.config.providers[provider.id];
    const price = entry?.price as { perImageUsd?: number; usdPerCredit?: number; creditsPerGeneration?: number } | undefined;
    if (typeof price?.perImageUsd === "number") return price.perImageUsd;
    if (typeof price?.usdPerCredit === "number" && typeof price?.creditsPerGeneration === "number") {
      return price.usdPerCredit * price.creditsPerGeneration;
    }
    return 0;   // unknown price; the two config locks still keep it disabled
  }

  /**
   * What a tool would cost if it ran now, from the configured price of whichever provider
   * would take it.
   *
   * Used to price a rebuild preview before anyone approves it, so the number a person sees
   * is the number the budget check will use. An unknown price is reported as zero and the
   * provider stays disabled by the config locks — never silently guessed.
   */
  priceOf(tool: string): number {
    const routing = this.routeQuietly(tool);
    return routing ? this.estimateUsd(routing) : 0;
  }

  /**
   * Which provider *would* take this tool, without probing whether it is available.
   *
   * Pricing a preview must not shell out to check whether Blender is installed: the
   * preview is drawn while a person is reading, and availability is answered elsewhere.
   */
  private routeQuietly(tool: string): Provider | null {
    if (!(tool in TOOL_SPECS)) return null;
    const capability = specOf(tool as Tool).capability;
    for (const id of this.config.capabilities[capability]?.order ?? []) {
      const provider = this.registry.get(id);
      if (provider?.tools.includes(tool as Tool)) return provider;
    }
    return null;
  }

  /** Sums every action in a representation's lineage: what this outcome actually cost. */
  costOf(representationId: string): Cost {
    return this.graph.actionsInLineage(representationId)
      .reduce<Cost>((acc, a) => addCost(acc, a.cost), zeroCost());
  }
}

/**
 * Where an output lands when the caller does not say. Roles are namespaced so a readiness
 * profile can ask for "the thing you would hand to Godot" rather than "some mesh".
 */
function defaultFormRole(tool: Tool): string {
  switch (tool) {
    case "image.generate": case "image.transform": return "art.primary";
    case "3d.generate": case "3d.process":        return "model.mesh";
    case "3d.export":                              return "delivery.mesh";
    case "video.generate": case "video.edit": case "video.export": return "preview.video";
    case "code.scaffold": case "code.patch":       return "code.project";
    case "doc.write":                              return "doc.primary";
    default:                                       return "source.primary";
  }
}
