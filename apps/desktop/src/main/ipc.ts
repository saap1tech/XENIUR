import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractCandidates } from "@xeniur/sensemaking";
import { z } from "zod";
import { ChallengeRulesSchema, ExitReasonSchema, GoalStatusSchema, ModeEnvelopeSchema, ModeKindSchema, OutreachEnvelopeSchema, PublisherRefSchema, ReportReasonSchema, TrustLevelSchema, authorizeFor, campaignPlan, campaignScope, describeEnvelope, describeRecipients, needsCampaign, planDigest, sha256Hex, UuidSchema, type ActionPlan, type IntentResult, type WorldSnapshot } from "@xeniur/core";
import { connectionsFor, contextMaterialFor, standingFor, importPackage, inspectPackage, outcomeOf, renderAuditPage, renderProofPage, supportMapFor, todayFor, trustFactsFor, trustFactsForWorld } from "@xeniur/graph";
import { compileContext } from "@xeniur/grammar";
import { policyFrom } from "@xeniur/models";
import { proposeFromBound } from "@xeniur/sensemaking";
import { SupportStatusSchema, type Tool, type PlanShape } from "@xeniur/core";
import { CriterionMarkSchema, PlacingSchema, SignedDocumentEnvelopeSchema } from "@xeniur/core";
import { policyConstraints } from "./services.js";
import { BrainIntentSchema, InvalidPlanError, bindProposal, resolveAsk, type BrainIntent } from "@xeniur/brain";
import { planForProposal, proposalsFor } from "@xeniur/grammar";
import type { Services } from "./services.js";
import { assertTrustedSender, UntrustedSenderError } from "./security.js";
import { captureWeb } from "./web/capture.js";
import { fetchArenaFeed } from "./web/arena.js";
import { generationFingerprint, verifiedGenerationPrice } from "./economy.js";

const Uuid = z.object({ id: UuidSchema });
const Rect = z.object({
  viewId: z.string().min(1),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});

/**
 * Every privileged channel, with its payload schema. There is one entry per capability
 * and no generic passthrough: the preload can only expose what is listed here, so the
 * allowlist is the API rather than a filter over a wider one.
 */
const SCHEMAS = {
  "worlds:list": z.undefined(),
  "worlds:create": z.object({ title: z.string().min(1), emoji: z.string().min(1).max(8), summary: z.string().optional() }),
  "worlds:open": Uuid,
  "objects:get": Uuid,
  "objects:representations": Uuid,
  "objects:lineage": Uuid,
  "objects:undo": Uuid,
  "objects:redo": Uuid,
  "intent:submit": z.object({
    worldId: UuidSchema, utterance: z.string().min(1).max(2000),
    selection: z.array(UuidSchema).max(32).optional(),
  }),
  "gestures:choose": z.object({
    worldId: UuidSchema, sourceId: UuidSchema, targetId: z.string().min(1).max(200),
    targetKind: z.enum(["claim", "object", "print", "delivery", "version", "question_lane", "decision", "work"]),
    label: z.string().min(1).max(100),
  }),
  "tasks:active": z.undefined(),
  "tasks:approve": Uuid,
  "tasks:reject": Uuid,
  "tasks:cancel": Uuid,
  "browser:open": z.object({ url: z.string().url().refine((u) => /^https?:/.test(u), "only http(s)") }),
  "browser:navigate": z.object({ viewId: z.string().min(1), url: z.string().url() }),
  "browser:setBounds": Rect,
  "browser:close": z.object({ viewId: z.string().min(1) }),
  "browser:status": z.object({ viewId: z.string().min(1) }),
  "web:settings": z.undefined(),
  "web:setRiskMode": z.object({ mode: z.enum(["local_only", "google_lookup"]) }),
  "web:explore": z.object({ worldId: UuidSchema, url: z.string().url().max(4000) }),
  "economy:snapshot": z.undefined(),
  "economy:confirm": z.object({ quoteId: UuidSchema }),
  "economy:cancel": z.object({ quoteId: UuidSchema }),
  "workflows:list": z.undefined(),
  "workflows:apply": z.object({ id: z.string().min(1).max(128) }),
  "code:files": Uuid,
  "code:run": Uuid,
  "code:stop": Uuid,
  "system:info": z.undefined(),

  /* Living Objects */
  "living:detail": Uuid,
  "living:validate": Uuid,
  "living:rebuild": z.object({ id: UuidSchema, includeGeneration: z.boolean().default(false) }),
  "living:release": z.object({ id: UuidSchema, profileId: z.string().min(1), note: z.string().max(500).optional() }),
  "living:switchBranch": z.object({ id: UuidSchema, branchId: UuidSchema }),
  "living:import": z.object({
    paths: z.array(z.string().min(1)).min(1).max(32),
    worldId: UuidSchema,
    objectId: UuidSchema.nullable().optional(),
  }),
  "living:export": Uuid,
  "living:impact": Uuid,
  "constraints:list": Uuid,
  "constraints:setValue": z.object({ id: UuidSchema, value: z.unknown() }),
  "modes:describe": z.object({ kind: ModeKindSchema, envelope: ModeEnvelopeSchema }),
  "modes:start": z.object({ kind: ModeKindSchema, envelope: ModeEnvelopeSchema, sheetDigest: z.string().min(1),
    worldId: UuidSchema.nullable() }),
  "modes:exit": z.object({ id: UuidSchema, reason: ExitReasonSchema }),
  "modes:active": z.undefined(),
  "modes:restrictions": z.undefined(),
  "seal:active": z.undefined(),
  "seal:beat": z.object({ modeId: UuidSchema, focusObjectId: UuidSchema.nullable(), versionId: UuidSchema.nullable() }),
  "seal:facts": Uuid,
  "seal:paste": z.object({ objectId: UuidSchema, versionId: UuidSchema.nullable(), chars: z.number().int().nonnegative(), sourceObjectId: UuidSchema.nullable().default(null) }),
  "rhythm:offer": z.object({ worldId: UuidSchema, objectId: UuidSchema.nullable() }),
  "rhythm:resolve": z.object({ id: UuidSchema, outcome: z.enum(["taken", "skipped"]) }),
  "rhythm:streak": z.undefined(),
  "packages:inspect": z.object({ path: z.string().min(1).endsWith(".xeniur") }),
  "packages:import": z.object({ path: z.string().min(1).endsWith(".xeniur"), as: z.enum(["work", "critique"]),
    worldId: UuidSchema.nullable() }),
  "challenges:list": z.undefined(),
  "challenges:get": Uuid,
  "challenges:matching": z.undefined(),
  "challenges:dismiss": Uuid,
  "challenges:create": z.object({ rules: ChallengeRulesSchema }),
  "challenges:enter": z.object({ worldId: UuidSchema, objectId: UuidSchema }),
  "challenges:entries": Uuid,
  "challenges:evaluate": z.object({ worldId: UuidSchema, objectId: UuidSchema }),
  "arena:feeds": z.undefined(),
  "arena:addFeed": z.object({ url: z.string().url().max(4000), label: z.string().max(120).default("") }),
  "arena:removeFeed": z.object({ url: z.string().url().max(4000) }),
  "arena:refresh": z.undefined(),
  "challenges:export": Uuid,
  "challenges:adoptFile": z.object({ path: z.string().min(1) }),
  "tickets:issue": z.object({ worldId: UuidSchema, participant: PublisherRefSchema, expiresAt: z.number().int().positive() }),
  "tickets:adoptFile": z.object({ path: z.string().min(1) }),
  "tickets:held": Uuid,
  "judging:status": Uuid,
  "judging:judges": Uuid,
  "judging:isJudge": Uuid,
  "judging:invite": z.object({ worldId: UuidSchema, judge: PublisherRefSchema }),
  "judging:open": Uuid,
  "judging:sheet": z.object({ worldId: UuidSchema, entryId: UuidSchema }),
  "judging:assess": z.object({ worldId: UuidSchema, entryId: UuidSchema, criteria: z.array(CriterionMarkSchema).min(1).max(8), note: z.string().max(4000).default("") }),
  "judging:assessments": Uuid,
  "judging:exportAssessment": Uuid,
  "judging:adoptFile": z.object({ path: z.string().min(1) }),
  "judging:publishResults": z.object({ worldId: UuidSchema, placings: z.array(PlacingSchema).max(50), note: z.string().max(4000).default("") }),
  "judging:results": Uuid,
  "judging:exportResults": Uuid,
  "outreach:describe": z.object({ envelope: OutreachEnvelopeSchema }),
  "outreach:create": z.object({ worldId: UuidSchema, envelope: OutreachEnvelopeSchema, digest: z.string().min(1) }),
  "outreach:send": z.object({ id: UuidSchema, message: z.object({
    to: z.string().email(), subject: z.string().min(1).max(200), body: z.string().min(1).max(20_000),
    fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  }).strict() }),
  "outreach:list": Uuid,
  "outreach:revoke": Uuid,
  "outreach:transportConfigured": z.undefined(),
  "publishers:self": z.undefined(),
  "publishers:list": z.undefined(),
  "publishers:setTrust": PublisherRefSchema.extend({ level: TrustLevelSchema }),
  "publishers:report": PublisherRefSchema.extend({ reason: ReportReasonSchema, note: z.string().max(500) }),
  "goals:current": Uuid,
  "goals:create": z.object({ worldId: UuidSchema, outcome: z.string().min(1).max(500), focusObjectId: UuidSchema.nullable() }),
  "goals:setStatus": z.object({ id: UuidSchema, status: GoalStatusSchema }),
  "goals:setOutcome": z.object({ id: UuidSchema, outcome: z.string().min(1).max(500) }),
  "goals:setFocus": z.object({ id: UuidSchema, objectId: UuidSchema.nullable() }),
  "goals:addNextAction": z.object({ id: UuidSchema, text: z.string().min(1).max(200), objectId: UuidSchema.nullable() }),
  "goals:doneNextAction": z.object({ id: UuidSchema, actionId: z.string().min(1) }),
  "goals:relevant": Uuid,
  "goals:standing": Uuid,
  "today:get": z.undefined(),
  "trust:facts": Uuid,
  "trust:world": Uuid,
  "trust:supportMap": Uuid,
  "trust:auditExport": Uuid,
  "trust:outcome": z.object({ id: UuidSchema, releaseId: UuidSchema.optional() }),
  "process:proof": Uuid,
  "process:publish": z.object({ id: UuidSchema, privacy: z.enum(["filtered", "public"]).default("filtered") }),
  "process:exportPage": z.object({ id: UuidSchema, eventIds: z.array(UuidSchema).max(500),
    discloseHashes: z.boolean(), discloseTiming: z.boolean() }),
  "metrics:record": z.object({
    kind: z.enum(["gesture_used", "typed_instead"]),
    concept: z.enum(["where", "when", "who", "cost", "quantity", "priority", "sequence", "relationship"]),
  }),

  /* Sensemaking */
  "sense:map": Uuid,
  "sense:friction": Uuid,
  "sense:dismissFriction": z.object({ id: UuidSchema, reason: z.string().max(500).optional() }),
  "sense:capture": z.object({
    worldId: UuidSchema,
    kind: z.enum(["article", "video", "podcast", "paper", "note", "conversation", "screenshot", "clip", "book"]),
    title: z.string().min(1).max(300),
    text: z.string().min(1).max(200_000),
    url: z.string().url().optional(),
    author: z.string().max(200).optional(),
  }),
  "sense:observe": z.object({ worldId: UuidSchema, text: z.string().min(1).max(4000), about: UuidSchema.optional() }),
  "sense:sort": z.object({ id: UuidSchema, lane: z.enum(["keep", "question", "connect", "test", "build", "ignore"]) }),
  "sense:rate": z.object({ id: UuidSchema, confidence: z.number().min(0).max(1).nullable() }),
  "sense:link": z.object({
    fromObjectId: UuidSchema, toObjectId: UuidSchema,
    relation: z.enum(["supports", "contradicts", "example_of", "asks_about", "same_as", "derived_from"]),
    note: z.string().max(500).optional(),
  }),

  "sense:reviewSupport": z.object({ id: UuidSchema, status: SupportStatusSchema, note: z.string().max(500) }),
  "sense:pendingCandidates": Uuid,
  "sense:basis": Uuid,
  "sense:connections": Uuid,
  "sense:acceptCandidate": z.object({ id: UuidSchema, acceptUnreviewed: z.boolean() }),
  "sense:rejectCandidate": Uuid,

  /* The Brain — what it would see is compiled and shown; what it did is one trail row */
  "brain:resolve": z.object({ utterance: z.string().min(1).max(2000), selection: z.array(UuidSchema).max(8) }),
  "objects:setAiProcessing": z.object({ id: UuidSchema, mode: z.enum(["allowed", "never"]) }),
  "brain:prepare": z.object({ worldId: UuidSchema, objectId: UuidSchema, intent: BrainIntentSchema, question: z.string().min(1).max(2000) }),
  "brain:ask": z.object({ trailId: UuidSchema, contextDigest: z.string().min(1), planDigest: z.string().min(1) }),
  "brain:trail": Uuid,

  /* Your models — the key is written once, read only in the main process, never echoed */
  "models:list": z.undefined(),
  "models:add": z.object({
    provider: z.enum(["anthropic", "openai", "google", "ollama"]),
    key: z.string().min(8).max(512),
  }),
  "models:remove": z.object({ provider: z.enum(["anthropic", "openai", "google", "ollama"]) }),
  "models:verify": z.object({ provider: z.enum(["anthropic", "openai", "google", "ollama"]) }),
  "models:finishFirstRun": z.undefined(),

  /* Decisions */
  "decisions:list": Uuid,
  "decisions:get": Uuid,
  "decisions:create": z.object({
    worldId: UuidSchema,
    question: z.string().min(1).max(500),
    options: z.array(z.object({
      key: z.string().min(1).max(60),
      label: z.string().min(1).max(200),
      note: z.string().max(500).default(""),
    })).max(12).default([]),
    chosenOption: z.string().max(60).nullable().optional(),
    rationale: z.string().max(4000).optional(),
  }),
  "decisions:cite": z.object({
    id: UuidSchema,
    sourceVersionId: UuidSchema.nullable().optional(),
    atomObjectId: UuidSchema.nullable().optional(),
    relation: z.enum(["supports", "contradicts", "informed_by"]).default("informed_by"),
    note: z.string().max(500).default(""),
  }),
  "decisions:assume": z.object({
    id: UuidSchema,
    text: z.string().min(1).max(1000),
    reviewTrigger: z.string().max(500).default(""),
  }),
  "decisions:accept": z.object({
    id: UuidSchema,
    /** One reason this could be wrong. Either this or skipSteelman must be present. */
    steelman: z.string().max(1000).optional(),
    reviewTrigger: z.string().max(500).optional(),
    skipSteelman: z.boolean().optional(),
  }),
  "decisions:reaffirm": Uuid,
  "decisions:passage": Uuid,
  "decisions:influence": z.object({ id: UuidSchema, releaseId: UuidSchema.optional() }),
} as const;

export type Channel = keyof typeof SCHEMAS;
export const CHANNELS = Object.keys(SCHEMAS) as Channel[];

function enqueuePlan(services: Services, worldId: string, plan: ActionPlan, computeQuoteId?: string): IntentResult {
  const objectId = plan.objects[0];
  const state = objectId ? services.graph.currentState(objectId) : null;
  const headForm = state?.forms[state.forms.length - 1];
  const head = headForm ? services.graph.getRepresentation(headForm.representationId) : undefined;
  const task = services.queue.enqueue({
    worldId, title: plan.intent, tool: plan.tool,
    payload: {
      plan, ...(objectId ? { objectId } : {}),
      ...(computeQuoteId ? { computeQuoteId } : {}),
      ...(head ? { inputs: [{ representationId: head.id, role: "source" }] } : {}),
    },
  });
  return { accepted: true, taskId: task.id, plan: { intent: plan.intent, tool: plan.tool, objects: plan.objects } };
}

export function registerIpc(services: Services): void {
  /** Prepared calls awaiting the person's confirmation, keyed by trail row. Never persisted. */
  const pending = new Map<string, {
    worldId: string; objectId: string; intent: BrainIntent; question: string;
    compiled: ReturnType<typeof compileContext>; plan: PlanShape; planDigest: string;
  }>();

  const handlers: { [K in Channel]: (args: z.infer<(typeof SCHEMAS)[K]>) => unknown } = {
    "worlds:list": () => services.graph.listWorlds(),
    "worlds:create": (a) => services.graph.createWorld(a),
    "worlds:open": ({ id }): WorldSnapshot | null => {
      const world = services.graph.getWorld(id);
      if (!world) return null;
      services.graph.touchWorld(id);
      const states = services.graph.listStates(id);
      return {
        world, states,
        representations: states.flatMap((s) => services.graph.listRepresentations(s.object.id)),
        tasks: services.queue.tasks.list(id),
        scene: null,
      };
    },
    "objects:get": ({ id }) => services.graph.currentState(id),
    "objects:representations": ({ id }) => services.graph.listRepresentations(id),
    "objects:lineage": ({ id }) => services.lineage(id),
    "objects:undo": ({ id }) => services.graph.undo(id),
    "objects:redo": ({ id }) => services.graph.redo(id),

    "intent:submit": async ({ worldId, utterance, selection }): Promise<IntentResult> => {
      const world = services.graph.getWorld(worldId);
      if (!world) return { accepted: false, taskId: null, plan: null, error: "no such world" };

      const selected = (selection ?? []).map((id) => services.graph.currentState(id))
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((state) => ({ state, representations: services.graph.listRepresentations(state.object.id) }));

      try {
        const { plan } = await services.brain.plan(utterance, {
          world: { id: world.id, title: world.title, emoji: world.emoji },
          selected,
          activeTasks: services.queue.tasks.active().map((t) => ({ id: t.id, title: t.title, status: t.status })),
        });

        const { provider } = await services.router.route(plan.tool);
        if (provider.kind === "generative") {
          const estimatedUsd = verifiedGenerationPrice(provider, services.config);
          const quote = services.compute.offer({ worldId, title: plan.intent, plan,
            fingerprint: generationFingerprint(services.graph, plan, provider.id, estimatedUsd),
            provider: provider.id, kind: "cloud", estimatedUsd,
            provenance: "The result will be recorded as AI-generated.",
            localAlternative: plan.tool === "3d.generate" ? "Create a basic local extrusion — 0 Compute" : null });
          return { accepted: true, taskId: null,
            plan: { intent: plan.intent, tool: plan.tool, objects: plan.objects }, quote };
        }
        return enqueuePlan(services, worldId, plan);
      } catch (err) {
        // A plan that will not validate never becomes a task.
        const error = err instanceof InvalidPlanError
          ? "I could not turn that into a plan I trust. Try saying it another way."
          : err instanceof Error ? err.message : String(err);
        return { accepted: false, taskId: null, plan: null, error };
      }
    },

    "gestures:choose": ({ worldId, sourceId, targetId, targetKind, label }): IntentResult => {
      const source = services.graph.currentState(sourceId);
      const target = services.graph.currentState(targetId);
      if (!source) return { accepted: false, taskId: null, plan: null, error: "no such source" };
      if (source.object.worldId !== worldId || (target && target.object.worldId !== worldId)) {
        return { accepted: false, taskId: null, plan: null, error: "gesture subjects must share this world" };
      }
      // What the target is, from the graph — not from the caller's word. A decision is a
      // decision, a claim a claim, anything else an Object; the Work zone has no Object.
      const expectedKind = target
        ? (services.graph.decisions.get(targetId) ? "decision" : target.properties.semanticType === "claim" ? "claim" : "object")
        : targetKind;
      if (target && targetKind !== expectedKind) {
        return { accepted: false, taskId: null, plan: null, error: "target kind no longer applies" };
      }
      const proposal = proposalsFor(
        { id: sourceId, title: source.properties.title, semanticType: source.properties.semanticType },
        { id: targetId, title: target?.properties.title ?? targetKind, kind: targetKind,
          semanticType: target?.properties.semanticType },
      ).find((candidate) => candidate.label === label);
      if (!proposal) return { accepted: false, taskId: null, plan: null, error: "proposal no longer applies" };
      return enqueuePlan(services, worldId, planForProposal(proposal));
    },

    "tasks:active": () => services.queue.tasks.active(),
    "tasks:approve": ({ id }) => { services.queue.approve(id); },
    "tasks:reject": ({ id }) => { services.queue.reject(id); },
    "tasks:cancel": ({ id }) => { services.queue.cancel(id); },

    "browser:open": ({ url }) => services.browser.open(url),
    "browser:navigate": ({ viewId, url }) => services.browser.navigate(viewId, url),
    "browser:setBounds": ({ viewId, rect }) => { services.browser.setBounds(viewId, rect); },
    "browser:close": ({ viewId }) => { services.browser.close(viewId); },
    "browser:status": ({ viewId }) => services.browser.status(viewId),
    "web:settings": () => ({
      riskMode: services.compute.preference("web.riskMode", "local_only") === "google_lookup" ? "google_lookup" as const : "local_only" as const,
      lookupConfigured: Boolean(process.env["GOOGLE_WEB_RISK_API_KEY"]),
      disclosure: "Google Lookup sends the full URL to Google. Local-only mode applies XENIUR's address policy without a reputation request.",
    }),
    "web:setRiskMode": ({ mode }) => {
      if (mode === "google_lookup" && !process.env["GOOGLE_WEB_RISK_API_KEY"]) throw new Error("Google Web Risk is not configured on this device.");
      services.compute.setPreference("web.riskMode", mode);
      return { riskMode: mode, lookupConfigured: Boolean(process.env["GOOGLE_WEB_RISK_API_KEY"]),
        disclosure: "Google Lookup sends the full URL to Google. Local-only mode applies XENIUR's address policy without a reputation request." };
    },
    "web:explore": async ({ worldId, url }) => {
      if (!services.graph.getWorld(worldId)) throw new Error("Choose a World before capturing this source.");
      const captured = await captureWeb(url, services.webRisk);
      const source = services.sense.recordSource({ worldId, kind: "article", title: captured.title,
        url: captured.url, text: captured.text, hash: sha256Hex(captured.text), extractor: "xeniur-explore/1",
        metadata: { risk: captured.risk.status } });
      const atoms = services.sense.acceptCandidates(worldId, source.id, extractCandidates(captured.text));
      return { objectId: source.id, sourceId: source.id, title: captured.title, url: captured.url,
        excerpt: captured.text.slice(0, 520), contentHash: sha256Hex(captured.text), risk: captured.risk, atomCount: atoms.length };
    },
    "economy:snapshot": () => services.compute.snapshot(),
    "economy:confirm": ({ quoteId }) => services.compute.confirm(quoteId, (quote) => enqueuePlan(services, quote.worldId, quote.plan, quote.id)),
    "economy:cancel": ({ quoteId }) => { services.compute.cancel(quoteId); },
    "workflows:list": () => services.workflows.list(),
    "workflows:apply": ({ id }) => services.workflows.apply(id),

    "code:files": ({ id }) => services.preview.files(id),
    "code:run": ({ id }) => {
      const rep = services.graph.listRepresentations(id).filter((r) => r.modality === "code").at(-1);
      if (!rep?.blobHash) throw new Error("this object has no project to run");
      services.preview.load(id, services.graph.readBlob(rep.blobHash));
      return services.preview.run(id);
    },
    "code:stop": ({ id }) => { services.preview.stop(id); },

    "system:info": () => services.systemInfo(),

    /* ------------------------------------------------------ Living Objects */

    "living:detail": ({ id }) => services.detailOf(id),

    "living:validate": async ({ id }) => {
      const summary = await services.validation.validate(id);
      return summary.checks;
    },

    "living:rebuild": async ({ id, includeGeneration }) => {
      const object = services.graph.getObject(id);
      if (!object) return null;
      // Deterministic rebuilds need no permission; generation does, and gets one bound to
      // the plan rather than a blanket yes granted by the fact that a button was clicked.
      await services.rebuild.run(id, { worldId: object.worldId, includeGeneration });
      // Checks are re-run straight away: a rebuilt form with stale evidence beside it is
      // exactly the kind of quiet wrongness readiness exists to prevent.
      await services.validation.validate(id);
      return services.detailOf(id);
    },

    "living:release": ({ id, profileId, note }) => {
      try {
        return services.readiness.approve({ objectId: id, profileId, note: note ?? null });
      } catch (err) {
        // NotReady is an answer, not a crash: the renderer shows what is missing.
        if (err instanceof Error && "blockers" in err) return null;
        throw err;
      }
    },

    "living:switchBranch": ({ id, branchId }) => services.graph.switchBranch(id, branchId),

    "living:impact": ({ id }) => services.impactOf(id),

    "constraints:list": ({ id }) => services.graph.constraints.list(id),
    "constraints:setValue": ({ id, value }) => services.graph.constraints.get(id)
      ? services.graph.constraints.setValue(id, value) : null,
    "modes:describe": ({ kind, envelope }) => describeEnvelope(kind, envelope),
    "modes:start": ({ kind, envelope, sheetDigest, worldId }) => {
      const mode = services.graph.modes.start({ kind, envelope, sheetDigest, worldId });
      services.metrics.record("mode_started", { detail: { kind } });
      return mode;
    },
    "modes:exit": ({ id, reason }) => {
      const mode = services.graph.modes.end(id, reason);
      if (mode) services.metrics.record(reason === "emergency" ? "mode_emergency_exit" : "mode_exited", { detail: { kind: mode.kind, reason } });
      return mode;
    },
    "modes:active": () => services.graph.modes.active(),
    "modes:restrictions": () => services.graph.modes.restrictions(),
    "seal:active": () => services.graph.seal.active(),
    "seal:beat": ({ modeId, focusObjectId, versionId }) => { services.graph.seal.beat({ modeId, focusObjectId, versionId }); },
    "seal:facts": ({ id }) => services.graph.seal.factsFor(id),
    "seal:paste": ({ objectId, versionId, chars, sourceObjectId }) => services.graph.process.recordPaste({ objectId, versionId, chars, sourceObjectId }),
    "rhythm:offer": ({ worldId, objectId }) => {
      const offer = services.rhythm.offer({ worldId, objectId });
      if (offer) services.metrics.record("reward_offered", { detail: { kind: offer.reward.kind } });
      return offer ? { id: offer.id, reward: offer.reward } : null;
    },
    "rhythm:resolve": ({ id, outcome }) => {
      services.rhythm.resolve(id, outcome);
      services.metrics.record(outcome === "taken" ? "reward_taken" : "reward_skipped");
    },
    "rhythm:streak": () => services.rhythm.streak(),
    "packages:inspect": async ({ path }) => {
      const i = await inspectPackage(services.graph, path);
      return {
        ok: i.ok, problems: i.problems, intent: i.manifest?.intent ?? null, relationship: i.relationship,
        contents: { objectId: i.contents.objectId, title: i.contents.title, versions: i.contents.versions,
          decisions: i.contents.decisions, sources: i.contents.sources, atoms: i.contents.atoms, bytes: i.contents.bytes },
        discloses: i.discloses, publisher: i.publisher,
      };
    },
    "packages:import": async ({ path, as, worldId }) => {
      const r = await importPackage(services.graph, path, { as, worldId: worldId ?? undefined });
      services.metrics.record(as === "critique" ? "critique_received" : "package_imported");
      return { objectId: r.objectId, worldId: r.worldId, alreadyPresent: r.alreadyPresent };
    },
    "challenges:list": () => services.graph.challenges.list(),
    "challenges:get": ({ id }) => services.graph.challenges.get(id),
    "challenges:matching": () => services.graph.challenges.matching(),
    "challenges:dismiss": ({ id }) => { services.graph.challenges.dismiss(id); },
    "challenges:create": ({ rules }) => services.graph.challenges.create(rules, services.graph.publishers.self()),
    "challenges:enter": ({ worldId, objectId }) =>
      services.graph.challenges.enter(worldId, objectId, services.graph.publishers.self().ref()),
    "challenges:entries": ({ id }) =>
      services.graph.challenges.entries(id, { self: services.graph.publishers.self().publicKey }),
    "challenges:evaluate": ({ worldId, objectId }) => services.graph.challenges.evaluate(worldId, objectId),
    "arena:feeds": () => services.arena.feeds(),
    "arena:addFeed": ({ url, label }) => services.arena.addFeed(url, label),
    "arena:removeFeed": ({ url }) => services.arena.removeFeed(url),
    "arena:refresh": async () => {
      // Every feed, through the same protected path a captured page takes; every document
      // verified against its publisher and quarantined by that publisher's trust here.
      const report: { feeds: number; adopted: string[]; alreadyHere: number; refused: Array<{ feed: string; title: string; why: string }>; failed: Array<{ feed: string; why: string }> } =
        { feeds: 0, adopted: [], alreadyHere: 0, refused: [], failed: [] };
      for (const f of services.arena.feeds()) {
        report.feeds += 1;
        let feed;
        try { feed = (await fetchArenaFeed(f.url, services.webRisk)).feed; }
        catch (cause) { report.failed.push({ feed: f.url, why: cause instanceof Error ? cause.message : String(cause) }); continue; }
        for (const doc of feed.challenges) {
          const title = ((doc.body as { rules?: { title?: string } })?.rules?.title) ?? "a challenge";
          try {
            const adopted = services.graph.challenges.adoptDocument(doc);
            if (adopted) report.adopted.push(adopted.rules.title); else report.alreadyHere += 1;
          } catch (cause) { report.refused.push({ feed: f.url, title, why: cause instanceof Error ? cause.message : String(cause) }); }
        }
      }
      return report;
    },
    "challenges:export": ({ id }) => {
      const doc = services.graph.challenges.exportDocument(id);
      if (!doc) throw new Error("no such challenge");
      const safe = doc.body.rules.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "challenge";
      const path = join(app.getPath("downloads"), `${safe}.xeniur-challenge.json`);
      writeFileSync(path, JSON.stringify(doc, null, 2), { encoding: "utf8", mode: 0o600 });
      return { path };
    },
    "challenges:adoptFile": ({ path }) => {
      const doc = SignedDocumentEnvelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      const adopted = services.graph.challenges.adoptDocument(doc);
      return adopted ? { worldId: adopted.worldId, title: adopted.rules.title, alreadyHere: false } : { worldId: null, title: null, alreadyHere: true };
    },
    "tickets:issue": ({ worldId, participant, expiresAt }) => {
      const doc = services.graph.tickets.issue(worldId, participant, expiresAt);
      const path = join(app.getPath("downloads"), `ticket-${participant.publicKey.slice(0, 8)}.xeniur-ticket.json`);
      writeFileSync(path, JSON.stringify(doc, null, 2), { encoding: "utf8", mode: 0o600 });
      return { path, ticket: doc.body };
    },
    "tickets:adoptFile": ({ path }) => services.graph.tickets.adopt(SignedDocumentEnvelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")))),
    "tickets:held": ({ id }) => services.graph.tickets.held(id),
    "judging:status": ({ id }) => services.graph.judging.status(id),
    "judging:judges": ({ id }) => services.graph.judging.judges(id),
    "judging:isJudge": ({ id }) => services.graph.judging.isJudge(id, services.graph.publishers.self().publicKey),
    "judging:invite": ({ worldId, judge }) => { services.graph.judging.invite(worldId, judge); return services.graph.judging.judges(worldId); },
    "judging:open": ({ id }) => { services.graph.judging.open(id); return services.graph.judging.status(id); },
    "judging:sheet": ({ worldId, entryId }) => services.graph.judging.sheetFor(worldId, entryId),
    "judging:assess": ({ worldId, entryId, criteria, note }) => services.graph.judging.assess(worldId, entryId, criteria, note).body,
    "judging:assessments": ({ id }) => services.graph.judging.assessments(id),
    "judging:exportAssessment": ({ id }) => {
      const doc = services.graph.judging.exportAssessment(id);
      if (!doc) throw new Error("no such assessment");
      const path = join(app.getPath("downloads"), `assessment-${id.slice(0, 8)}.xeniur-judging.json`);
      writeFileSync(path, JSON.stringify(doc, null, 2), { encoding: "utf8", mode: 0o600 });
      return { path };
    },
    "judging:adoptFile": ({ path }) => {
      // A signed document from elsewhere: parsed as data, verified before anything is written.
      const doc = SignedDocumentEnvelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      if (doc.kind === "xeniur.judging/1") return { kind: doc.kind, adopted: services.graph.judging.adopt(doc).id };
      if (doc.kind === "xeniur.results/1") return { kind: doc.kind, adopted: services.graph.judging.adoptResults(doc).challengeDigest };
      throw new Error(`${doc.kind} is not adopted here`);
    },
    "judging:publishResults": ({ worldId, placings, note }) => services.graph.judging.publishResults(worldId, placings, note),
    "judging:results": ({ id }) => services.graph.judging.results(id),
    "judging:exportResults": ({ id }) => {
      const doc = services.graph.judging.results(id);
      if (!doc) throw new Error("no results have been published");
      const path = join(app.getPath("downloads"), `results-${id.slice(0, 8)}.xeniur-results.json`);
      writeFileSync(path, JSON.stringify(doc, null, 2), { encoding: "utf8", mode: 0o600 });
      return { path };
    },
    "outreach:describe": ({ envelope }) => {
      const plan = campaignPlan(envelope);
      const r = envelope.recipients;
      return {
        needsCampaign: needsCampaign(r),
        digest: planDigest(plan),
        lines: [
          { label: "Purpose", value: envelope.purpose },
          { label: "To", value: describeRecipients(r) + (r.kind === "list" ? `: ${r.addresses.join(", ")}` : "") },
          { label: "At most", value: `${envelope.maxSends} send${envelope.maxSends === 1 ? "" : "s"}` },
          { label: "Until", value: new Date(envelope.expiresAt).toISOString().slice(0, 16).replace("T", " ") },
          { label: "May leave", value: envelope.dataAllowed.length > 0 ? envelope.dataAllowed.join(", ") : "nothing beyond the template" },
          { label: "Each send", value: "is a COMMUNICATE with its own receipt" },
        ],
      };
    },
    "outreach:create": ({ worldId, envelope, digest }) => {
      // The approval is minted here, from the envelope the sheet showed. A digest that does
      // not match means the person read a different envelope than the one being created.
      const plan = campaignPlan(envelope);
      if (planDigest(plan) !== digest) throw new Error("the envelope changed after it was shown — review it again");
      const authorization = authorizeFor(plan, {
        scope: campaignScope(envelope), ttlMs: Math.max(60_000, envelope.expiresAt - Date.now()),
      });
      return services.graph.outreach.create(worldId, envelope, authorization);
    },
    "outreach:send": async ({ id, message }) => {
      const r = await services.graph.outreach.send(id, message, services.mail);
      if (r.outcome === "sent") services.metrics.record("outreach_sent");
      return { outcome: r.outcome, reason: r.reason, receiptObjectId: r.receiptObjectId };
    },
    "outreach:list": ({ id }) => services.graph.outreach.list(id),
    "outreach:revoke": ({ id }) => services.graph.outreach.revoke(id),
    "outreach:transportConfigured": () => services.mail.configured(),
    "publishers:self": () => services.graph.publishers.self().ref(),
    "publishers:list": () => services.graph.publishers.list(),
    "publishers:setTrust": ({ publicKey, displayName, level }) => {
      services.graph.publishers.setTrust({ publicKey, displayName }, level);
      return services.graph.publishers.view({ publicKey, displayName });
    },
    "publishers:report": ({ publicKey, displayName, reason, note }) =>
      services.graph.publishers.report({ publicKey, displayName }, reason, { note }),
    "goals:current": ({ id }) => services.graph.goals.current(id),
    "goals:create": ({ worldId, outcome, focusObjectId }) => {
      const goal = services.graph.goals.create(worldId, outcome, { focusObjectId });
      services.metrics.record("goal_set", { detail: { status: goal.status } });
      return goal;
    },
    "goals:setStatus": ({ id, status }) => {
      const goal = services.graph.goals.setStatus(id, status);
      if (goal) services.metrics.record(status === "finished" ? "goal_finished" : "goal_status_changed", { detail: { status } });
      return goal;
    },
    "goals:setOutcome": ({ id, outcome }) => services.graph.goals.setOutcome(id, outcome),
    "goals:setFocus": ({ id, objectId }) => services.graph.goals.setFocus(id, objectId),
    "goals:addNextAction": ({ id, text, objectId }) => services.graph.goals.addNextAction(id, { text, objectId }),
    "goals:doneNextAction": ({ id, actionId }) => services.graph.goals.doneNextAction(id, actionId),
    "goals:relevant": ({ id }) => services.graph.goals.relevantObjects(id),
    "goals:standing": ({ id }) => standingFor(services.graph, id),
    "today:get": () => todayFor(services.graph, { rhythm: services.rhythm }),
    "trust:world": ({ id }) => trustFactsForWorld(services.graph, id),
    "trust:supportMap": ({ id }) => supportMapFor(services.graph, id),
    "trust:auditExport": ({ id }) => {
      const state = services.graph.currentState(id);
      if (!state) throw new Error("This Object no longer exists.");
      const { html, manifest } = renderAuditPage(services.graph, id);
      const safe = state.properties.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "object";
      const path = join(app.getPath("downloads"), `${safe}-audit.html`);
      writeFileSync(path, html, { encoding: "utf8", mode: 0o600 });
      return { path, rootHash: manifest.rootHash };
    },
    "trust:facts": ({ id }) => services.graph.getObject(id) ? trustFactsFor(services.graph, id) : null,
    "trust:outcome": ({ id, releaseId }) => services.graph.getObject(id) ? outcomeOf(services.graph, id, releaseId) : null,
    "process:proof": ({ id }) => services.graph.process.proof(id),
    "process:publish": ({ id, privacy }) => services.graph.process.publish(id, privacy),
    "process:exportPage": ({ id, eventIds, discloseHashes, discloseTiming }) => {
      const state = services.graph.currentState(id);
      if (!state) throw new Error("This Object no longer exists.");
      const result = renderProofPage(services.graph.process.proof(id), { title: state.properties.title,
        eventIds, discloseHashes, discloseTiming });
      const safe = state.properties.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "process";
      const path = join(app.getPath("downloads"), `${safe}-process.html`);
      writeFileSync(path, result.html, { encoding: "utf8", mode: 0o600 });
      return { path, rootHash: result.manifest.rootHash };
    },
    "metrics:record": ({ kind, concept }) => { services.metrics.record(kind, { detail: { concept } }); },

    /* --------------------------------------------------------- Your models */

    "models:list": () => services.models.list(),
    "models:add": ({ provider, key }) => services.models.add(provider, key),
    "models:remove": ({ provider }) => services.models.remove(provider),
    "models:verify": ({ provider }) => services.models.verify(provider),
    "models:finishFirstRun": () => { services.models.finishFirstRun(); },

    /* ----------------------------------------------------------- Decisions */

    "decisions:list": ({ id }) => services.graph.decisions.list(id),
    "decisions:get": ({ id }) => services.graph.decisions.detail(id),

    "decisions:create": ({ worldId, question, options, chosenOption, rationale }) => {
      const created = services.graph.decisions.create({
        worldId, question,
        options: options.map((o) => ({ key: o.key, label: o.label, note: o.note })),
        chosenOption: chosenOption ?? null, rationale: rationale ?? "",
      });
      return services.graph.decisions.detail(created.objectId);
    },

    "decisions:cite": ({ id, sourceVersionId, atomObjectId, relation, note }) => {
      services.graph.decisions.cite(id, {
        sourceVersionId: sourceVersionId ?? null,
        atomObjectId: atomObjectId ?? null,
        atomVersionId: null, relation, note,
      });
      return services.graph.decisions.detail(id);
    },

    "decisions:assume": ({ id, text, reviewTrigger }) => {
      services.graph.decisions.assume(id, { text, reviewTrigger });
      return services.graph.decisions.detail(id);
    },

    // Accepting renders the brief deterministically. No model is involved, so this needs
    // no permission beyond being in the app.
    "decisions:accept": ({ id, steelman, reviewTrigger, skipSteelman }) => {
      try {
        const detail = services.graph.decisions.accept(id, "you", { steelman, reviewTrigger, skipSteelman });
        // A skip is recorded as a skip, never as agreement; a reason is recorded as a reason.
        services.metrics.record(steelman ? "steelman_recorded" : "steelman_skipped", { objectId: id });
        services.metrics.record("decision_accepted", { objectId: id });
        return detail;
      } catch (err) {
        // SteelmanRequired is an answer, not a crash: the renderer asks the question.
        if (err instanceof Error && "code" in err && (err as { code: string }).code === "steelman_required") {
          return null;
        }
        throw err;
      }
    },
    "decisions:reaffirm": ({ id }) => {
      services.graph.decisions.reaffirm(id);
      return services.graph.decisions.detail(id);
    },

    "decisions:passage": ({ id }) => services.passageOf(id),
    "decisions:influence": ({ id, releaseId }) =>
      services.graph.decisions.influenceOn(id, releaseId),

    "living:import": async ({ paths, worldId, objectId }) => {
      const out = [];
      for (const path of paths) {
        const target = objectId ?? services.graph.createObject({
          worldId, semanticType: "file",
          title: path.split("/").pop() ?? "Imported file",
        }).object.id;

        const result = await services.router.execute(
          { intent: `import ${path.split("/").pop()}`, objects: [target], tool: "import.file",
            args: { path }, confirmation: false },
          { worldId, objectId: target, formRoles: ["source.primary", "model.mesh"], label: "imported" },
        );
        if (result.state) out.push(result.state);
      }
      return out;
    },

    "living:export": async ({ id }) => {
      const state = services.graph.currentState(id);
      if (!state) return null;
      const safe = state.properties.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const outPath = join(app.getPath("downloads"), `${safe || "object"}.xeniur`);
      return services.packageOf(id, outPath);
    },

    /* --------------------------------------------------------- Sensemaking */

    "sense:map": ({ id }) => services.thinkingMap(id),
    "sense:friction": ({ id }) => services.sense.friction(id),
    "sense:dismissFriction": ({ id, reason }) => { services.sense.dismissFriction(id, reason ?? ""); },

    "sense:capture": ({ worldId, kind, title, text, url, author }) => {
      const source = services.sense.recordSource({
        worldId, kind, title, url: url ?? null, author: author ?? null,
      });
      // Heuristic candidates, offered as such. Nothing is written in as understood.
      const atoms = services.sense.acceptCandidates(worldId, source.id, extractCandidates(text));
      return { sourceId: source.id, atoms };
    },

    "sense:observe": ({ worldId, text, about }) =>
      services.sense.observe(worldId, text, about ? { about } : {}),
    "sense:sort": ({ id, lane }) => services.sense.sort(id, lane),
    "sense:rate": ({ id, confidence }) => services.sense.rate(id, confidence),
    "sense:link": (input) => {
      services.sense.link({
        fromObjectId: input.fromObjectId, toObjectId: input.toObjectId,
        relation: input.relation, note: input.note ?? null,
      });
    },
    "sense:reviewSupport": ({ id, status, note }) => {
      const row = services.sense.reviewSupport(id, status, note);
      if (row) services.metrics.record("support_reviewed", { objectId: row.claimObjectId, detail: { status } });
      return row;
    },
    "sense:pendingCandidates": ({ id }) => services.sense.pendingCandidates(id),
    "sense:basis": ({ id }) => {
      // Where it came from, and a support row to review for the copy it cites — created
      // unresolved if none exists yet. Deterministic; no model.
      const atom = services.sense.getAtom(id);
      if (atom?.sourceVersionId && !services.graph.support.of(id).some((s) => s.sourceVersionId === atom.sourceVersionId)) {
        services.graph.support.record({ claimObjectId: id, sourceVersionId: atom.sourceVersionId, locator: atom.locator });
      }
      return { passage: services.passageOf(id), support: services.graph.support.of(id) };
    },
    "sense:connections": ({ id }) => connectionsFor(services.graph, id),
    "sense:acceptCandidate": ({ id, acceptUnreviewed }) => {
      try {
        const atom = services.sense.accept(id, { acceptUnreviewed });
        if (atom) services.metrics.record("proposal_accepted", { objectId: atom.objectId, detail: { stance: atom.stance } });
        return atom;
      } catch (err) {
        if (err instanceof Error && err.name === "UnreviewedCitations") return null;   // the renderer asks
        throw err;
      }
    },
    "sense:rejectCandidate": ({ id }) => {
      services.sense.reject(id);
      services.metrics.record("proposal_rejected");
    },

    /* --------------------------------------------------------- The Brain */

    "brain:resolve": ({ utterance, selection }) => {
      const subjects = selection.map((id) => services.graph.currentState(id))
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => ({ id: s.object.id, title: s.properties.title, semanticType: s.properties.semanticType }));
      return resolveAsk(utterance, subjects);
    },
    "objects:setAiProcessing": ({ id, mode }) => {
      const current = services.graph.currentState(id);
      if (!current) return null;
      const state = services.graph.commitVersion({
        objectId: id, properties: { settings: { ...current.properties.settings, aiProcessing: mode } },
        label: mode === "never" ? "not sent to AI" : "may be sent to AI",
      });
      if (mode === "never") services.graph.envelopes.revoke(current.object.worldId, id);
      return state;
    },
    "brain:prepare": ({ worldId, objectId, intent, question }) => {
      const material = contextMaterialFor(services.graph, objectId);
      if (!material) throw new Error("no such Object to compile a context for");
      const { strengthId, restrictedId } = policyConstraints(services.graph);
      const policy = policyFrom(
        services.graph.constraints.get(strengthId)?.value, services.graph.constraints.get(restrictedId)?.value,
      );
      // Route first, because the destination decides what may be included at all.
      const sealed = services.graph.seal.active()?.envelope.remoteModels === false;
      const probe = services.gatedBrain.resolverFor()?.resolve(intent, { escalation: 0, hasRestrictedSources: false, localOnly: sealed }) ?? null;
      const destination: "local" | "remote" = probe && /ollama|local/.test(probe.id) ? "local" : "remote";
      const compiled = compileContext(material, { destination, maxTokens: 6000 });
      const estimatedUsd = probe ? services.gatedBrain.estimateUsd(probe.pricing) : 0;
      const plan = services.gatedBrain.planFor(intent, compiled.contextDigest, estimatedUsd);
      const row = services.graph.trail.saw({
        worldId, objectId, intent, digest: compiled.contextDigest,
        included: compiled.included.length, excluded: compiled.excluded.length,
      });
      services.metrics.record("context_reviewed", { objectId, detail: { intent, included: compiled.included.length } });
      if (compiled.excluded.length > 0) {
        for (const why of new Set(compiled.excluded.map((e) => e.why))) {
          services.metrics.record("context_excluded", { objectId, detail: { why, count: compiled.excluded.filter((e) => e.why === why).length } });
        }
      }
      if (probe) services.metrics.record("model_routed", { objectId, detail: { intent, model: probe.id, escalation: probe.escalation, localOnly: policy.localOnlyForRestricted } });
      pending.set(row.id, { worldId, objectId, intent, question, compiled, plan, planDigest: planDigest(plan) });
      const includedIds = compiled.included.map((i) => i.id);
      const level = services.graph.envelopes.level(worldId, intent, includedIds, compiled.includesRestricted);
      return {
        trailId: row.id, level, delta: services.graph.envelopes.delta(worldId, intent, includedIds),
        needsKey: destination === "remote" && probe === null,
        context: {
          included: compiled.included.map((i) => ({ kind: i.kind, id: i.id, label: i.label, tokens: i.tokens })),
          excluded: compiled.excluded.map((e) => ({ kind: e.kind, id: e.id, label: e.label, why: e.why })),
          tokens: compiled.tokens, includesRestricted: compiled.includesRestricted, contextDigest: compiled.contextDigest,
          destination, modelLabel: probe?.id ?? null, estimatedUsd,
        },
        planDigest: planDigest(plan),
      };
    },

    "brain:ask": async ({ trailId, contextDigest, planDigest: approvedDigest }) => {
      const prepared = pending.get(trailId);
      if (!prepared) throw new Error("nothing was prepared under that trail row — prepare again");
      if (prepared.compiled.contextDigest !== contextDigest || prepared.planDigest !== approvedDigest) {
        throw new Error("what was shown is not what would be sent — review it again");
      }
      pending.delete(trailId);
      // Proceeding is approval of exactly this content: the envelope grows by it.
      services.graph.envelopes.approve(prepared.worldId, prepared.intent, prepared.compiled.included.map((i) => i.id));
      const authorization = authorizeFor(prepared.plan, { scope: "brain.ask" });
      services.graph.trail.decided(trailId, "pending", null);   // provisional; overwritten below via a fresh read
      const world = services.graph.getWorld(prepared.worldId)!;
      const state = services.graph.currentState(prepared.objectId);
      const registry = {
        worldId: prepared.worldId, objectIds: new Set(services.graph.listObjects(prepared.worldId).map((o) => o.id)),
        representationIds: new Set<string>(), versionIds: new Set<string>(), formRoles: new Map<string, ReadonlySet<string>>(),
        availableTools: new Set<Tool>(["knowledge.propose", "doc.write"]),
        sourceTexts: sourceTextsFor(services, prepared.worldId),
      };
      const result = await services.gatedBrain.ask(prepared.intent, prepared.question, {
        world: { id: world.id, title: world.title, emoji: world.emoji },
        selected: state ? [{ state, representations: services.graph.listRepresentations(state.object.id) }] : [], activeTasks: [],
      }, registry, { compiled: prepared.compiled, authorization, hasRestrictedSources: prepared.compiled.includesRestricted,
        // A running Sealed Session with remote models off is read here, at the call — never remembered.
        sealed: services.graph.seal.active()?.envelope.remoteModels === false });

      // The row fills as far as the truth goes and no further.
      services.graph.db.prepare(`UPDATE agent_trail SET decided = NULL, decided_model = NULL WHERE id = ?`).run(trailId);
      let proposed: { claims: number; steps: number; unsupported: number } | null = null;
      if (result.status === "ok") {
        services.graph.trail.decided(trailId, result.outcome.kind, result.model);
        services.graph.trail.authorized(trailId, approvedDigest, "CREATE");
        if (result.outcome.kind === "executable" && result.outcome.plan.tool === "knowledge.propose") {
          const bound = bindProposal(result.outcome.plan.args, registry.sourceTexts);
          const out = proposeFromBound(services.sense, prepared.worldId, bound, { sourceTexts: registry.sourceTexts });
          proposed = { claims: out.claimCandidates.length, steps: out.stepCandidates.length, unsupported: out.unsupportedClaimIds.length };
        }
        for (const r of result.routed) {
          services.metrics.record("model_routed", { objectId: prepared.objectId, detail: { intent: prepared.intent, model: r.model, escalation: r.escalation } });
        }
      } else {
        services.graph.trail.decided(trailId, result.status, null);
      }
      return {
        status: result.status, reason: result.status === "ok" ? null : result.reason,
        proposed, trail: services.graph.trail.get(trailId),
      };
    },
    "brain:trail": ({ id }) => services.graph.trail.forObject(id),
  };

  for (const channel of CHANNELS) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      try {
        // Who is asking, then what are they asking. Both, in that order, every time.
        assertTrustedSender(event);
        const args = SCHEMAS[channel].parse(payload);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one cast at the boundary
        return await (handlers[channel] as (a: any) => unknown)(args);
      } catch (err) {
        if (err instanceof UntrustedSenderError) {
          console.error(`[XENIUR] ${channel}: ${err.message} (origin ${err.origin})`);
          throw new Error("refused");           // never echo internals to a renderer
        }
        if (err instanceof z.ZodError) {
          console.error(`[XENIUR] ${channel}: invalid payload — ${err.issues.map((i) => i.message).join("; ")}`);
          throw new Error("invalid request");
        }
        throw err;
      }
    });
  }
}


/** Stored source text by source version, for binding a proposal's citations word by word. */
function sourceTextsFor(services: Services, worldId: string): Map<string, string> {
  const out = new Map<string, string>();
  const rows = services.graph.db.prepare(
    `SELECT v.id, v.text_blob_hash FROM source_versions v JOIN sources s ON s.id = v.source_id WHERE s.world_id = ?`,
  ).all(worldId) as Array<{ id: string; text_blob_hash: string | null }>;
  for (const r of rows) {
    if (!r.text_blob_hash) continue;
    try { out.set(r.id, services.graph.readBlob(r.text_blob_hash).toString("utf8")); } catch { /* a copy that did not travel */ }
  }
  return out;
}
