import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractCandidates } from "@xeniur/sensemaking";
import { z } from "zod";
import { ExitReasonSchema, ModeEnvelopeSchema, ModeKindSchema, PublisherRefSchema, ReportReasonSchema, TrustLevelSchema, describeEnvelope, sha256Hex, UuidSchema, type ActionPlan, type IntentResult, type WorldSnapshot } from "@xeniur/core";
import { outcomeOf, renderProofPage, trustFactsFor } from "@xeniur/graph";
import { InvalidPlanError } from "@xeniur/brain";
import { planForProposal, proposalsFor } from "@xeniur/grammar";
import type { Services } from "./services.js";
import { assertTrustedSender, UntrustedSenderError } from "./security.js";
import { captureWeb } from "./web/capture.js";
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
    targetKind: z.enum(["claim", "object", "print", "delivery", "version", "question_lane"]),
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
  "rhythm:offer": z.object({ worldId: UuidSchema, objectId: UuidSchema.nullable() }),
  "rhythm:resolve": z.object({ id: UuidSchema, outcome: z.enum(["taken", "skipped"]) }),
  "rhythm:streak": z.undefined(),
  "publishers:self": z.undefined(),
  "publishers:list": z.undefined(),
  "publishers:setTrust": PublisherRefSchema.extend({ level: TrustLevelSchema }),
  "publishers:report": PublisherRefSchema.extend({ reason: ReportReasonSchema, note: z.string().max(500) }),
  "trust:facts": Uuid,
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
      const expectedKind = target?.properties.semanticType === "claim" ? "claim" : target ? "object" : targetKind;
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
    "publishers:self": () => services.graph.publishers.self().ref(),
    "publishers:list": () => services.graph.publishers.list(),
    "publishers:setTrust": ({ publicKey, displayName, level }) => {
      services.graph.publishers.setTrust({ publicKey, displayName }, level);
      return services.graph.publishers.view({ publicKey, displayName });
    },
    "publishers:report": ({ publicKey, displayName, reason, note }) =>
      services.graph.publishers.report({ publicKey, displayName }, reason, { note }),
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
        return services.graph.decisions.accept(id, "you", { steelman, reviewTrigger, skipSteelman });
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
