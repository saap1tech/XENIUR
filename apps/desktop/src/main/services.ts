import type { BrowserWindow } from "electron";
import type { OutreachTransport,
  Authorization, HistoryPayload, LineagePayload, ObjectDetail, SystemInfo, Task, TaskEvent, Tool,
} from "@xeniur/core";
import {
  DisabledTransport, ObjectGraph, ReadinessEvaluator, RhythmStore, ideaDna, loadProfiles, loadRhythmConfig, exportPackage, impactOf, SpendLedger,
  MetricsStore,
  ComputeLedger, WorkflowLibrary,
} from "@xeniur/graph";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { WebRiskChecker } from "./web/risk.js";
import { generationFingerprint, verifiedGenerationPrice } from "./economy.js";
import { TaskQueue } from "@xeniur/tasks";
import { PermissionBroker } from "@xeniur/permissions";
import { SessionBroker } from "@xeniur/sessions";
import { CapabilityRouter, RebuildRunner } from "@xeniur/router";
import { ValidationRunner } from "@xeniur/validators";
import { SensemakingStore, buildThinkingMap } from "@xeniur/sensemaking";
import {
  Brain, GatedBrain, MockLlmClient, OpenRouterClient, routerRequest,
  type LlmClient, type ModelResolver,
} from "@xeniur/brain";
import {
  ALL_PROVIDERS, loadProvidersConfig, type ProviderEnv, type ProvidersConfig,
} from "@xeniur/providers";
import type { ImpactReport, ResolvedPassage } from "@xeniur/core";
import {
  ModelRegistry, RESTRICTED_CONSTRAINT, STRENGTH_CONSTRAINT, DEFAULT_POLICY, policyFrom, routeModel,
  routerTextModels, routerImageModel, routerCeiling, recommendRouterModels, rateModel, byFit, ModelsConfigSchema, type KeyStore, type ModelEntry, type ModelProvider, type RoutedIntent,
} from "@xeniur/models";
import type { ModelChoiceView, ModelProviderView, ProjectModelsView } from "@xeniur/core";
import { appPaths, BINARIES } from "./paths.js";
import { SafeStorageKeyStore, SafeStorageRouteTokens, SafeStorageSigningKeyStore } from "./keys.js";
import { TabManager } from "./web/tabs.js";
import { HttpsJsonAdapter, type RouteEndpoint } from "./routes/https-json.js";
import { JourneyStore } from "./journey/store.js";
import { downloadResource } from "./journey/resources.js";
import { PreviewRuntime } from "./preview.js";

export interface Services {
  graph: ObjectGraph;
  journey: JourneyStore;
  /** Which models one project uses, each with its standing (Recommended, Strong, Basic, Experimental). */
  projectModels: { view(worldId: string): ProjectModelsView; set(worldId: string, text: string | null, image: string | null): Promise<ProjectModelsView> };
  /** Your models: registry, keychain-backed keys, verified selection and spend limits. */
  models: {
    registry: ModelRegistry;
    keys: KeyStore;
    list(): ModelProviderView[];
    add(provider: ModelProvider, key: string): ModelProviderView[];
    remove(provider: ModelProvider): ModelProviderView[];
    verify(provider: ModelProvider): Promise<{ ok: boolean; models: string[]; balanceCredits?: number; reason: string | null }>;
    select(modelId: string, selected: boolean): Promise<ModelProviderView[]>;
    budget(): { perActionUsdMax: number; monthlyUsdMax: number; monthlySpentUsd: number };
    setBudget(perActionUsdMax: number, monthlyUsdMax: number): { perActionUsdMax: number; monthlyUsdMax: number; monthlySpentUsd: number };
    firstRun(): boolean;
    finishFirstRun(): void;
  };
  rebuild: RebuildRunner;
  validation: ValidationRunner;
  readiness: ReadinessEvaluator;
  /** Rewards from the graph on a predictable cadence. Off unless config says otherwise. */
  rhythm: RhythmStore;
  sense: SensemakingStore;
  detailOf(objectId: string): ObjectDetail | null;
  /** What changed since the last delivery, split into rebuild and review. */
  impactOf(objectId: string): ImpactReport | null;
  /** The stored passage an atom came from, with the title of what it came from. */
  passageOf(atomObjectId: string): (ResolvedPassage & { sourceTitle: string }) | null;
  historyOf(objectId: string): HistoryPayload;
  thinkingMap(worldId: string): ReturnType<typeof buildThinkingMap> | null;
  packageOf(objectId: string, outPath: string): Promise<{ path: string; bytes: number }>;
  queue: TaskQueue;
  broker: PermissionBroker;
  sessions: SessionBroker;
  metrics: MetricsStore;
  compute: ComputeLedger;
  workflows: WorkflowLibrary;
  webRisk: WebRiskChecker;
  /** Routes the person configured, and the tokens that are theirs. */
  routes: { adapter: HttpsJsonAdapter; endpoints: RouteEndpoint[]; tokens: SafeStorageRouteTokens };
  /** Arena feeds: URLs the person added (config/arena.json plus this machine's preferences). */
  arena: {
    feeds(): Array<{ url: string; label: string }>;
    addFeed(url: string, label: string): Array<{ url: string; label: string }>;
    removeFeed(url: string): Array<{ url: string; label: string }>;
  };
  /** Outreach transport. Disabled with an empty key: the mechanism is complete, nothing is reachable. */
  mail: OutreachTransport;
  router: CapabilityRouter;
  brain: Brain;
  /** The bounded Brain; a live call still needs a verified, selected model and consent. */
  gatedBrain: GatedBrain;
  spend: SpendLedger;
  config: ProvidersConfig;
  env: ProviderEnv;
  /** Browsing inside XENIUR: profiles, tabs, one visible view each. */
  browser: TabManager;
  preview: PreviewRuntime;
  systemInfo(): Promise<SystemInfo>;
  /** Every provider id the registry actually implements — what config may name. */
  providerIds: string[];
  lineage(representationId: string): LineagePayload;
  dispose(): Promise<void>;
}

/** The legacy task planner; project Ask uses the separately consented GatedBrain. */
function makeBrain(config: ProvidersConfig): Brain {
  const entry = config.brain.providers[config.brain.default];
  let client: LlmClient = new MockLlmClient();

  return new Brain(client, { maxOutputTokens: entry?.maxOutputTokens ?? 1200, maxRepairs: 1 });
}

/**
 * The routing policy as two Constraint Objects in a settings World, and a resolver that
 * applies them.
 *
 * The World is created on first use and hidden from Home by its summary marker. The
 * constraints are ordinary Objects: versioned, undoable, rendered by PriorityBalance and a
 * toggle. Providers without a transport wired yet are simply not candidates — the registry
 * lists them, the model view says "transport not wired yet", and routing never pretends.
 */
const SETTINGS_WORLD = "__xeniur_settings__";
const WIRED_PROVIDERS: ReadonlySet<ModelProvider> = new Set<ModelProvider>(["openrouter"]);

function settingsWorldId(graph: ObjectGraph): string {
  const existing = graph.listWorlds().find((w) => w.summary === SETTINGS_WORLD);
  if (existing) return existing.id;
  return graph.createWorld({ title: "XENIUR settings", emoji: "⚙", summary: SETTINGS_WORLD }).id;
}

export function policyConstraints(graph: ObjectGraph): { strengthId: string; restrictedId: string } {
  const worldId = settingsWorldId(graph);
  const find = (tag: string) => graph.listStates(worldId).find((s) => s.properties.tags.includes(tag))?.object.id;
  let strengthId = find("routing.strength");
  let restrictedId = find("routing.restricted");
  if (!strengthId) {
    strengthId = graph.createObject({
      worldId, semanticType: "constraint", title: "How strong a model, per task",
      properties: { tags: ["constraint", "routing.strength"] },
    }).object.id;
    graph.constraints.define(strengthId, STRENGTH_CONSTRAINT, worldId, DEFAULT_POLICY.strength);
  }
  if (!restrictedId) {
    restrictedId = graph.createObject({
      worldId, semanticType: "constraint", title: "Keep restricted sources on this machine",
      properties: { tags: ["constraint", "routing.restricted"] },
    }).object.id;
    graph.constraints.define(restrictedId, RESTRICTED_CONSTRAINT, worldId, DEFAULT_POLICY.localOnlyForRestricted);
  }
  return { strengthId, restrictedId };
}

function makeResolver(graph: ObjectGraph, registry: ModelRegistry, keys: KeyStore,
                      usable: (model: ModelEntry) => boolean): ModelResolver {
  const clientFor = (m: ModelEntry): LlmClient | null => {
    if (m.provider === "openrouter" && m.output !== "image") return new OpenRouterClient({
      apiKey: keys.read("openrouter") ?? undefined, model: m.model,
      inputPerMTok: m.price.inputPerMTok, outputPerMTok: m.price.outputPerMTok, reasoning: m.reasoning,
    });
    return null;
  };
  return {
    resolve(intent, ctx) {
      const { strengthId, restrictedId } = policyConstraints(graph);
      const policy = policyFrom(
        graph.constraints.get(strengthId)?.value, graph.constraints.get(restrictedId)?.value,
      );
      const wired = new ModelRegistry({
        ...registry.config, models: registry.config.models.filter((m) => WIRED_PROVIDERS.has(m.provider) && usable(m)),
      });
      const route = routeModel(intent as RoutedIntent, policy, wired, (p) => keys.has(p), ctx);
      if (!route) return null;
      const client = clientFor(route.model);
      if (!client) return null;
      return {
        id: route.model.id, client,
        pricing: {
          inputPerMTok: route.model.price.inputPerMTok, outputPerMTok: route.model.price.outputPerMTok,
          verified: route.model.price.verifiedOn !== null || route.model.tags.includes("local"),
          verifiedOn: route.model.price.verifiedOn,
        },
        because: route.because, escalation: route.escalation,
      };
    },
  };
}

function makeGatedBrain(config: ProvidersConfig, ledger: SpendLedger, resolver?: ModelResolver): GatedBrain {
  const entry = config.brain.providers[config.brain.default];
  const price = (entry?.price ?? {}) as {
    inputPerMTok?: number; outputPerMTok?: number; unverified?: boolean; verifiedOn?: string;
  };

  const client: LlmClient = new MockLlmClient();

  return new GatedBrain(client, {
    ledger,
    ...(resolver ? { resolver } : {}),
    pricing: {
      inputPerMTok: price.inputPerMTok ?? 0,
      outputPerMTok: price.outputPerMTok ?? 0,
      // An unverified price is not a free one. Absent metadata reads as unverified.
      verified: price.unverified === false && typeof price.verifiedOn === "string",
      verifiedOn: price.verifiedOn ?? null,
    },
    // The resolver is the live gate: without a selected, verified, priced model it returns
    // no client. The renderer still presents the exact request and estimate for consent.
    liveCallsEnabled: true,
    maxOutputTokens: entry?.maxOutputTokens ?? 1200,
    maxRepairs: 1,
  });
}

export function createServices(window: BrowserWindow): Services {
  const paths = appPaths();
  const config = loadProvidersConfig(paths.projectRoot);
  const graph = ObjectGraph.open({
    dbPath: paths.dbPath, blobDir: paths.blobDir,
    signingKeys: new SafeStorageSigningKeyStore(paths.root),
  });

  // Every grant is revoked when XENIUR starts. A restored position restores no authority:
  // what the assistant may do is decided again, by the person, in this run.
  graph.grants.revokeAll("XENIUR restarted");

  /* ------------------------------------------------------------ your models
   *
   * Keys live in the OS keychain through safeStorage and never touch the graph. The renderer
   * learns only whether a key is present; the bytes are read here, for verification and for a
   * model call, and nowhere else. A non-secret choices file stores the selected model ids;
   * setup returns on launch until one is usable. A local-only dismissal lasts one session.
   */
  const modelRegistry = ModelRegistry.load(paths.projectRoot);
  const catalogFile = join(paths.root, "openrouter-catalog.json");
  try {
    const cached = ModelsConfigSchema.parse(JSON.parse(readFileSync(catalogFile, "utf8")));
    modelRegistry.config.models = cached.models.filter(m => m.provider === "openrouter");
  } catch { /* A missing or invalid cache requires a fresh connection check. */ }
  const freshPrice = (m: ModelEntry) => !!m.price.verifiedOn && Date.now() - Date.parse(m.price.verifiedOn) < 7 * 86400_000;

  const keyStore = new SafeStorageKeyStore(paths.root);
  const routeTokens = new SafeStorageRouteTokens(keyStore);
  const modelChoicesFile = join(paths.root, "model-choices.json");
  const budgetFile = join(paths.root, "model-budget.json");
  const Choices = z.object({ selected: z.array(z.string()), verified: z.record(z.array(z.string())) });
  let choices: z.infer<typeof Choices> = { selected: [], verified: {} };
  try { if (existsSync(modelChoicesFile)) choices = Choices.parse(JSON.parse(readFileSync(modelChoicesFile, "utf8"))); }
  catch { choices = { selected: [], verified: {} }; }
  const saveChoices = () => writeFileSync(modelChoicesFile, JSON.stringify(choices));
  let dismissedThisRun = false;
  const accessConfirmed = (m: ModelEntry) => Boolean(modelRegistry.provider(m.provider)?.local || keyStore.has(m.provider)) &&
    (choices.verified[m.provider] ?? []).some((id) =>
    id === m.model || id === `models/${m.model}` || (m.provider === "ollama" && id.startsWith(`${m.model}:`)));
  /** Reads one text model's providers (a free call) and widens its price ceiling to two of them. */
  const widenCeiling = async (key: string | undefined, id: string): Promise<boolean> => {
    const m = modelRegistry.model(id);
    if (!m || m.provider !== "openrouter" || m.output === "image" || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:-]+$/.test(m.model)) return false;
    try {
      const widened = routerCeiling(m, await routerRequest(key, `/models/${m.model}/endpoints`));
      if (widened === m) return false;
      modelRegistry.config.models = modelRegistry.config.models.map((entry) => entry.id === id ? widened : entry);
      return true;
    } catch { return false; /* The listed price still bounds the call; only the fallback is lost. */ }
  };
  /** Callable here: verified for this key, freshly priced and wired, whether or not chosen app-wide. */
  const modelCallable = (m: ModelEntry) => accessConfirmed(m) &&
    WIRED_PROVIDERS.has(m.provider) && m.modelVerified && freshPrice(m) &&
    (m.output === "image" ? m.imagePriceUsd !== undefined && !!m.imageProvider : modelRegistry.callable((p) => p === m.provider && keyStore.has(p)).some((candidate) => candidate.id === m.id));
  const modelUsable = (m: ModelEntry) => choices.selected.includes(m.id) && modelCallable(m);

  const providerView = (): ModelProviderView[] => modelRegistry.providers().map((p) => {
    const keyPresent = p.local || keyStore.has(p.id);
    return {
      id: p.id, label: p.label, local: p.local, keyPresent,
      canStore: p.local || SafeStorageKeyStore.available(),
      verified: keyPresent && (choices.verified[p.id]?.length ?? 0) > 0,
      unlocks: modelRegistry.unlocks(p.id),
      models: modelRegistry.models().filter((m) => m.provider === p.id).map((m) => ({
        id: m.id, label: m.label, priceVerifiedOn: m.price.verifiedOn,
        inputPerMTok: m.price.inputPerMTok, outputPerMTok: m.price.outputPerMTok,
        callable: modelUsable(m), selected: choices.selected.includes(m.id),
        accessible: accessConfirmed(m), output: m.output, imagePriceUsd: m.imagePriceUsd,
        fit: rateModel(m).fit, fitNote: rateModel(m).note,
      })),
    };
  });

  const models: Services["models"] = {
    registry: modelRegistry, keys: keyStore,
    list: providerView,
    add: (provider, key) => { if (provider !== "openrouter") throw new Error("Use OpenRouter for AI connections."); keyStore.write(provider, key); delete choices.verified[provider]; saveChoices(); return providerView(); },
    remove: (provider) => { keyStore.remove(provider); delete choices.verified[provider]; choices.selected = choices.selected.filter((id) => modelRegistry.model(id)?.provider !== provider); saveChoices(); return providerView(); },
    verify: async (provider) => {
      if (provider !== "openrouter") throw new Error("Use OpenRouter for AI connections.");
      try {
        const key = keyStore.read("openrouter") ?? undefined;
        const account = await routerRequest(key, "/key");
        if (!account.data || account.data.is_management_key || account.data.is_provisioning_key) throw new Error("Use an inference API key from OpenRouter.");
        const date = new Date().toISOString().slice(0, 10);
        const text = routerTextModels(await routerRequest(key, "/models/user"), date);
        let images: ModelEntry[] = [];
        try {
          const list = await routerRequest(key, "/images/models");
          const candidates = (list.data ?? []).filter((m: any) => m.architecture?.output_modalities?.includes("image"));
          candidates.sort((a: any,b: any) => Number(!/seedream|flux|recraft/.test(a.id)) - Number(!/seedream|flux|recraft/.test(b.id)));
          for (const candidate of candidates.slice(0, 12)) {
            if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:/-]+$/.test(candidate.id)) continue;
            const image = routerImageModel(candidate, await routerRequest(key, `/images/models/${candidate.id}/endpoints`), date);
            if (image) images.push(image);
            if (images.length >= 4) break;
          }
        } catch { /* Text still works; unavailable/unpriced image models stay unavailable. */ }
        modelRegistry.config.models = [...text, ...images];
        choices.verified.openrouter = modelRegistry.models().map(m=>m.model);
        choices.selected = choices.selected.filter(id=>modelRegistry.models().some(m=>m.id === id));
        if (!choices.selected.some(id=>modelRegistry.model(id)?.output !== "image")) choices.selected.push(...recommendRouterModels(modelRegistry.models()).filter(id=>!choices.selected.includes(id)));
        for (const id of choices.selected) await widenCeiling(key, id);
        writeFileSync(catalogFile, JSON.stringify(modelRegistry.config));
        saveChoices();
        return { ok: true, models: choices.verified.openrouter, reason: images.length ? null : "Text is ready. No image endpoint with a fixed, verified price was available." };
      } catch (error) {
        choices.verified.openrouter = []; saveChoices();
        return { ok: false, models: [], reason: error instanceof Error ? error.message : "Could not check OpenRouter." };
      }
    },
    select: async (modelId, selected) => {
      const m = modelRegistry.model(modelId);
      if (!m || !WIRED_PROVIDERS.has(m.provider) || !m.modelVerified || (!m.price.verifiedOn && !m.tags.includes("local"))) throw new Error("This model cannot run here yet.");
      if (selected && !accessConfirmed(m)) throw new Error("Verify access to this model first.");
      choices.selected = choices.selected.filter((id) => id !== modelId);
      if (selected) choices.selected.push(modelId);
      saveChoices();
      if (selected && await widenCeiling(keyStore.read("openrouter") ?? undefined, modelId)) writeFileSync(catalogFile, JSON.stringify(modelRegistry.config));
      return providerView();
    },
    budget: () => ({ perActionUsdMax: spend.limits().perActionUsdMax,
      monthlyUsdMax: spend.limits().monthlyUsdMax ?? config.budget.totalUsdMax,
      monthlySpentUsd: spend.monthlySpent() }),
    setBudget: (perActionUsdMax, monthlyUsdMax) => {
      const limits = { ...spend.limits(), perActionUsdMax, monthlyUsdMax };
      spend.setLimits(limits);
      writeFileSync(budgetFile, JSON.stringify({ perActionUsdMax, monthlyUsdMax }));
      return models.budget();
    },
    firstRun: () => !dismissedThisRun && !modelRegistry.models().some(m => m.output !== "image" && modelUsable(m)),
    finishFirstRun: () => { dismissedThisRun = true; },
  };
  const broker = new PermissionBroker(graph.db);
  const sessions = new SessionBroker(graph.db);
  const metrics = new MetricsStore(graph.db);
  metrics.start();
  const env: ProviderEnv = {
    scratchDir: paths.scratchDir, rootDir: paths.projectRoot, binaries: BINARIES,
  };
  const policy = z.object({ usdPerCompute: z.number().positive().nullable(), intelligenceRolling: z.number().int().nonnegative(),
    intelligenceReserve: z.number().int().nonnegative(), rollingHours: z.number().positive() }).parse(
    JSON.parse(readFileSync(join(paths.projectRoot, "config/economy.json"), "utf8")));
  const compute = new ComputeLedger(graph.db, policy);
  const workflows = new WorkflowLibrary(graph);
  const webRisk = new WebRiskChecker(() => ({ mode: compute.preference("web.riskMode", "local_only") === "google_lookup" ? "google_lookup" : "local_only",
    key: process.env["GOOGLE_WEB_RISK_API_KEY"] }));
  const router = new CapabilityRouter({ graph, broker, config, env, computeGate: {
    reserve: (plan, ctx, provider) => compute.reserve(ctx.computeQuoteId!, generationFingerprint(graph, plan, provider.id, verifiedGenerationPrice(provider, config))),
    settle: (id, usd) => compute.settle(id, usd),
  } });
  const brain = makeBrain(config);
  const savedBudget = (() => {
    try { return z.object({ perActionUsdMax: z.number().positive().max(5), monthlyUsdMax: z.number().positive().max(10000) })
      .parse(JSON.parse(readFileSync(budgetFile, "utf8"))); }
    catch { return { perActionUsdMax: config.budget.perActionUsdMax, monthlyUsdMax: config.budget.totalUsdMax }; }
  })();
  const spend = new SpendLedger(graph.db, { ...config.budget, totalUsdMax: 1_000_000, ...savedBudget });
  const gatedBrain = makeGatedBrain(config, spend, makeResolver(graph, modelRegistry, keyStore, modelUsable));
  const queue = new TaskQueue(graph.db, { concurrency: 3 });
  const rebuild = new RebuildRunner(graph, router);
  const validation = new ValidationRunner(graph, env);
  const readiness = new ReadinessEvaluator(graph, loadProfiles(paths.projectRoot));
  const rhythm = new RhythmStore(graph.db, graph, graph.modes, loadRhythmConfig(paths.projectRoot));
  const sense = new SensemakingStore(graph);

  // Readiness gates actions in the same place the Broker already gates money.
  broker.useReadiness({
    unmet: (tool, objectId) => readiness.guarding(tool)
      .map((p) => readiness.evaluate(objectId, p.id))
      .filter((r): r is NonNullable<typeof r> => r !== null && !r.ready)
      .map((r) => ({
        profileId: r.profileId, profileName: r.profileName,
        blockers: r.blockers.map((b) => b.detail),
      })),
  });

  // Routes the person configured, with their own tokens. Registered so a route can be named
  // in a review; whether it can run is the adapter's own honest answer.
  const routeEndpoints: RouteEndpoint[] = (() => {
    try { return (JSON.parse(readFileSync(join(paths.projectRoot, "config/routes.json"), "utf8")) as { endpoints?: RouteEndpoint[] }).endpoints ?? []; }
    catch { return []; }
  })();
  const httpsJson = new HttpsJsonAdapter({ endpoints: routeEndpoints, tokens: routeTokens });
  graph.delegated.register(httpsJson);
  // An attempt that was in flight when XENIUR closed is uncertain, never assumed either way.
  graph.delegated.reconcileInterrupted();

  const browser = new TabManager(window, webRisk, graph, join(paths.scratchDir, "downloads"),
    (tabId) => { try { window.webContents.send("xeniur:browser-event", { tabId }); } catch { /* the window may be gone */ } });
  if(!browser.profiles().some(p=>p.kind==="ephemeral"))browser.createProfile("Public browsing","ephemeral");
  const preview = new PreviewRuntime(window);

  // Every tool the queue can run. A task that names anything else fails loudly rather
  // than hanging, which is what the queue's own test asserts.
  const RUNNABLE: Tool[] = [
    "image.generate", "image.transform", "3d.generate", "3d.process", "3d.export",
    "video.generate", "video.edit", "video.export", "code.scaffold", "code.patch",
    "doc.write", "object.create", "object.update", "object.move",
  ];
  for (const tool of RUNNABLE) {
    queue.register(tool, async (ctx) => {
      const payload = ctx.task.payload as {
        plan?: { intent: string; objects: string[]; tool: Tool; args: Record<string, unknown> };
        objectId?: string; inputs?: Array<{ representationId: string; role: "source" }>;
        authorization?: Authorization;
        computeQuoteId?: string;
      };
      if (!payload.plan) throw new Error("task payload has no plan");
      ctx.progress(0.1, "starting");
      const result = await router.execute(
        { ...payload.plan, confirmation: false },
        {
          worldId: ctx.task.worldId, taskId: ctx.task.id,
          // The queue carries the authorization a person granted for this exact plan;
          // `ctx.approved` only says the task was resumed, which is not the same thing.
          ...(payload.authorization ? { authorization: payload.authorization } : {}),
          ...(payload.computeQuoteId ? { computeQuoteId: payload.computeQuoteId } : {}),
          ...(payload.objectId ? { objectId: payload.objectId } : {}),
          ...(payload.inputs ? { inputs: payload.inputs } : {}),
          label: ctx.task.title,
        },
      );
      ctx.progress(1, `${result.representations[0]?.format ?? "done"} via ${result.provider}`);
    });
  }
  queue.start();

  // Task events are the Active area. Push them straight to the renderer.
  queue.subscribe((event: TaskEvent, task: Task) => {
    if (!window.isDestroyed()) window.webContents.send("xeniur:task-event", { event, task });
  });

  const systemInfo = async (): Promise<SystemInfo> => {
    const capabilities = await Promise.all(ALL_PROVIDERS.map(async (p) => {
      const state = await p.available(env);
      return {
        id: p.id, kind: p.kind, available: state.ok,
        ...(state.ok ? {} : { reason: state.reason }),
      };
    }));
    return {
      version: "0.1.0", brainIsMock: !modelRegistry.models().some(m => m.output !== "image" && modelUsable(m)),
      brainModel: modelRegistry.models().find(m => m.output !== "image" && modelUsable(m))?.label ?? null, capabilities,
      firstRun: models.firstRun(),
    };
  };

  const lineage = (representationId: string): LineagePayload => {
    const steps = graph.ancestryOf(representationId).map((s) => ({
      ...s, representation: graph.getRepresentation(s.representationId),
    }));
    const actions = graph.actionsInLineage(representationId);
    return { steps, actions, totalUsd: graph.costOfLineage(representationId).usd };
  };

  const historyOf = (objectId: string): HistoryPayload => ({
    versions: graph.versionChain(objectId).map((v) => ({
      id: v.id, seq: v.seq, label: v.label, branchId: v.branchId,
      formCount: graph.formsAt(v.id).length, createdAt: v.createdAt,
    })),
    branches: graph.listBranches(objectId).map((b) => ({
      id: b.id, name: b.name, headVersionId: b.headVersionId,
    })),
  });

  /** Everything the Object view needs, in one round trip rather than eight. */
  const detailOf = (objectId: string): ObjectDetail | null => {
    const state = graph.currentState(objectId);
    if (!state) return null;
    const head = state.forms[state.forms.length - 1];
    return {
      state,
      representations: graph.listRepresentations(objectId),
      steps: graph.recipes.statusOf(objectId),
      rebuildPlan: graph.recipes.recipeAtCurrentVersion(objectId)
        ? graph.recipes.planRebuild(objectId)
        : null,
      checks: graph.db.prepare(
        `SELECT * FROM checks WHERE object_id = ? ORDER BY at DESC`,
      ).all(objectId).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: row["id"] as string, objectId,
          representationId: (row["representation_id"] as string | null) ?? null,
          validator: row["validator"] as string,
          status: row["status"] as "pass" | "warn" | "fail" | "skipped",
          summary: row["summary"] as string,
          detail: JSON.parse((row["detail"] as string) || "{}") as Record<string, unknown>,
          formRole: (row["form_role"] as string | null) ?? null, at: row["at"] as number,
          subjectKind: (row["subject_kind"] as "representation" | "object_version" | "unbound") ?? "unbound",
          subjectId: (row["subject_id"] as string | null) ?? null,
          subjectHash: (row["subject_hash"] as string | null) ?? null,
          validatorVersion: (row["validator_version"] as string) ?? "0.0.0",
          params: JSON.parse((row["params"] as string) || "{}") as Record<string, unknown>,
          environment: JSON.parse((row["environment"] as string) || "{}") as Record<string, unknown>,
          runId: (row["run_id"] as string | null) ?? null,
        };
      }),
      readiness: readiness.evaluateAll(objectId),
      releases: readiness.releasesOf(objectId),
      history: historyOf(objectId),
      dna: ideaDna(graph, { objectId }),
      lineage: head ? lineage(head.representationId) : null,
    };
  };

  /**
   * The rebuild/review split for one Object.
   *
   * Generative steps are priced from the providers config rather than guessed here, so the
   * number a person sees before approving is the number that will actually be charged.
   */
  const impactOfObject = (objectId: string): ImpactReport | null =>
    graph.getObject(objectId)
      ? impactOf(graph, objectId, { costOf: (tool: string) => router.priceOf(tool) })
      : null;

  const passageOf = (atomObjectId: string) => {
    const passage = sense.passageOf(atomObjectId);
    if (!passage) return null;
    const atom = sense.getAtom(atomObjectId);
    const source = atom?.sourceId ? sense.getSource(atom.sourceId) : null;
    return { ...passage, sourceTitle: source?.title ?? "a source" };
  };

  const thinkingMap = (worldId: string) =>
    graph.getWorld(worldId) ? buildThinkingMap(graph, sense, worldId) : null;

  // Feeds come from the shipped config and from what the person adds here; both are just URLs.
  const arena: Services["arena"] = {
    feeds() {
      const shipped = (() => {
        try { return (JSON.parse(readFileSync(join(paths.projectRoot, "config/arena.json"), "utf8")) as { feeds?: Array<{ url: string; label?: string }> }).feeds ?? []; }
        catch { return []; }
      })();
      const added = JSON.parse(compute.preference("arena.feeds", "[]")) as Array<{ url: string; label?: string }>;
      const seen = new Set<string>();
      return [...shipped, ...added].filter((f) => f.url && !seen.has(f.url) && seen.add(f.url)).map((f) => ({ url: f.url, label: f.label ?? "" }));
    },
    addFeed(url, label) {
      const added = JSON.parse(compute.preference("arena.feeds", "[]")) as Array<{ url: string; label: string }>;
      if (!added.some((f) => f.url === url)) compute.setPreference("arena.feeds", JSON.stringify([...added, { url, label }]));
      return arena.feeds();
    },
    removeFeed(url) {
      const added = JSON.parse(compute.preference("arena.feeds", "[]")) as Array<{ url: string; label: string }>;
      compute.setPreference("arena.feeds", JSON.stringify(added.filter((f) => f.url !== url)));
      return arena.feeds();
    },
  };

  const journey = new JourneyStore({ graph, sense, spend, projectRoot:paths.projectRoot,
    models: () => modelRegistry.models().filter(modelUsable), key: () => keyStore.read("openrouter"),
    catalog: () => modelRegistry.models().filter(modelCallable),
    download: (url) => downloadResource(url, webRisk),
    reference: () => `data:image/png;base64,${readFileSync(join(paths.projectRoot,"brand/illustrations/research-path.png")).toString("base64")}`,
  });
  /** A model as a person choosing it sees it: its rating, why, and what it costs. */
  const choiceView = (m: ModelEntry): ModelChoiceView => {
    const rating = rateModel(m);
    return { id: m.id, label: m.label, model: m.model, output: m.output, fit: rating.fit, note: rating.note,
      inputPerMTok: m.price.inputPerMTok, outputPerMTok: m.price.outputPerMTok,
      ...(m.imagePriceUsd !== undefined ? { imagePriceUsd: m.imagePriceUsd } : {}) };
  };
  // A typical step reads far more than it writes, so text models are compared at ten parts input to two output.
  const typicalPrice = (c: ModelChoiceView) => c.output === "image" ? c.imagePriceUsd ?? 0 : (c.inputPerMTok ?? 0) * 10 + (c.outputPerMTok ?? 0) * 2;
  const projectModels: Services["projectModels"] = {
    view(worldId) {
      const all = modelRegistry.models().filter(modelCallable).map(choiceView)
        .sort((a, b) => byFit({ fit: a.fit, price: typicalPrice(a) }, { fit: b.fit, price: typicalPrice(b) }));
      return { text: all.filter((c) => c.output !== "image"), image: all.filter((c) => c.output === "image"),
        chosen: journey.projectModels(worldId),
        current: { text: journey.currentModel(worldId, false)?.id ?? null, image: journey.currentModel(worldId, true)?.id ?? null } };
    },
    async set(worldId, text, image) {
      // The chosen writing model gets the same two-provider price ceiling as an app-wide choice.
      if (text && await widenCeiling(keyStore.read("openrouter") ?? undefined, text)) writeFileSync(catalogFile, JSON.stringify(modelRegistry.config));
      journey.setProjectModels(worldId, text, image);
      return projectModels.view(worldId);
    },
  };
  return {
    graph, journey, projectModels, models, queue, broker, sessions, metrics, compute, workflows, webRisk, arena,
    routes: { adapter: httpsJson, endpoints: routeEndpoints, tokens: routeTokens }, mail: new DisabledTransport(), router, brain, gatedBrain, spend, config, env, browser, preview,
    rebuild, validation, readiness, rhythm, sense,
    detailOf, historyOf, thinkingMap,
    impactOf: impactOfObject, passageOf,
    packageOf: (objectId, outPath) => exportPackage(graph, objectId, outPath)
      .then((r) => ({ path: r.path, bytes: r.bytes })),
    systemInfo, lineage, providerIds: ALL_PROVIDERS.map((p) => p.id),
    async dispose() {
      metrics.end();
      browser.closeAll(true);
      preview.stopAll();
      await queue.stop();
      graph.close();
    },
  };
}
