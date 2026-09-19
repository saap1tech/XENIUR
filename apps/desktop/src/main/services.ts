import type { BrowserWindow } from "electron";
import type {
  Authorization, HistoryPayload, LineagePayload, ObjectDetail, SystemInfo, Task, TaskEvent, Tool,
} from "@xeniur/core";
import {
  ObjectGraph, ReadinessEvaluator, ideaDna, loadProfiles, exportPackage, impactOf, SpendLedger,
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
  Brain, GatedBrain, MockLlmClient, OpenAiClient, type LlmClient,
} from "@xeniur/brain";
import {
  ALL_PROVIDERS, loadProvidersConfig, type ProviderEnv, type ProvidersConfig,
} from "@xeniur/providers";
import type { ImpactReport, ResolvedPassage } from "@xeniur/core";
import { ModelRegistry, verifyKey, type KeyStore, type ModelProvider } from "@xeniur/models";
import type { ModelProviderView } from "@xeniur/core";
import { appPaths, BINARIES } from "./paths.js";
import { SafeStorageKeyStore } from "./keys.js";
import { BrowserShell } from "./browser.js";
import { PreviewRuntime } from "./preview.js";

export interface Services {
  graph: ObjectGraph;
  /** Your models: the registry, the keychain-backed key store, and the first-run flag. */
  models: {
    registry: ModelRegistry;
    keys: KeyStore;
    list(): ModelProviderView[];
    add(provider: ModelProvider, key: string): ModelProviderView[];
    remove(provider: ModelProvider): ModelProviderView[];
    verify(provider: ModelProvider): Promise<{ ok: boolean; models: string[]; reason: string | null }>;
    firstRun(): boolean;
    finishFirstRun(): void;
  };
  rebuild: RebuildRunner;
  validation: ValidationRunner;
  readiness: ReadinessEvaluator;
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
  router: CapabilityRouter;
  brain: Brain;
  /**
   * The bounded Brain, built and switched off.
   *
   * `liveCallsEnabled` is false and there is no key handling on this path, so the branch
   * that would reach a provider is not taken. It is here so it can be exercised, not so it
   * can run.
   */
  gatedBrain: GatedBrain;
  spend: SpendLedger;
  config: ProvidersConfig;
  env: ProviderEnv;
  browser: BrowserShell;
  preview: PreviewRuntime;
  systemInfo(): Promise<SystemInfo>;
  lineage(representationId: string): LineagePayload;
  dispose(): Promise<void>;
}

/**
 * Chooses the Brain's client. The mock is the default and the only one that can run
 * today: the OpenAI client stays inert until a key is present and the model id in
 * config/providers.json has actually been verified against live pricing.
 */
function makeBrain(config: ProvidersConfig): Brain {
  const entry = config.brain.providers[config.brain.default];
  let client: LlmClient = new MockLlmClient();

  if (config.brain.default === "openai" && entry?.enabled) {
    client = new OpenAiClient({
      apiKey: process.env["OPENAI_API_KEY"],
      model: entry.model ?? "unset",
      modelVerified: entry.modelVerified === true,
    });
  }
  return new Brain(client, { maxOutputTokens: entry?.maxOutputTokens ?? 1200, maxRepairs: 1 });
}

/**
 * The bounded Brain, assembled from configuration and left switched off.
 *
 * Two independent gates, either of which alone stops a call: the model must be enabled in
 * config *and* its price must be marked verified. Both are false in the shipped config, so
 * this milestone makes no request under any circumstances and holds no key.
 */
function makeGatedBrain(config: ProvidersConfig, ledger: SpendLedger): GatedBrain {
  const entry = config.brain.providers[config.brain.default];
  const price = (entry?.price ?? {}) as {
    inputPerMTok?: number; outputPerMTok?: number; unverified?: boolean; verifiedOn?: string;
  };

  const client: LlmClient = config.brain.default === "openai" && entry?.enabled
    ? new OpenAiClient({
        apiKey: process.env["OPENAI_API_KEY"],
        model: entry.model ?? "unset",
        modelVerified: entry.modelVerified === true,
      })
    : new MockLlmClient();

  return new GatedBrain(client, {
    ledger,
    pricing: {
      inputPerMTok: price.inputPerMTok ?? 0,
      outputPerMTok: price.outputPerMTok ?? 0,
      // An unverified price is not a free one. Absent metadata reads as unverified.
      verified: price.unverified === false && typeof price.verifiedOn === "string",
      verifiedOn: price.verifiedOn ?? null,
    },
    // The switch, held closed for this milestone. Turning it on is a deliberate edit here
    // and a verified price in config, not an environment variable somebody exports.
    liveCallsEnabled: false,
    maxOutputTokens: entry?.maxOutputTokens ?? 1200,
    maxRepairs: 1,
  });
}

export function createServices(window: BrowserWindow): Services {
  const paths = appPaths();
  const config = loadProvidersConfig(paths.projectRoot);
  const graph = ObjectGraph.open({ dbPath: paths.dbPath, blobDir: paths.blobDir });

  /* ------------------------------------------------------------ your models
   *
   * Keys live in the OS keychain through safeStorage and never touch the graph. The renderer
   * learns only whether a key is present; the bytes are read here, for verification and for a
   * model call, and nowhere else. First-run is a marker file rather than a database row, so
   * a person who wipes their data sees the scenes again — which is the right behaviour.
   */
  const modelRegistry = ModelRegistry.load(paths.projectRoot);
  const keyStore: KeyStore = new SafeStorageKeyStore(paths.root);
  const firstRunMarker = join(paths.root, ".first-run-done");

  const providerView = (): ModelProviderView[] => modelRegistry.providers().map((p) => {
    const keyPresent = p.local || keyStore.has(p.id);
    return {
      id: p.id, label: p.label, local: p.local, keyPresent,
      canStore: p.local || SafeStorageKeyStore.available(),
      unlocks: modelRegistry.unlocks(p.id),
      models: modelRegistry.models().filter((m) => m.provider === p.id).map((m) => ({
        id: m.id, label: m.label, priceVerifiedOn: m.price.verifiedOn,
        callable: keyPresent && modelRegistry.callable((q) => q === p.id ? keyPresent : keyStore.has(q))
          .some((c) => c.id === m.id),
      })),
    };
  });

  const models: Services["models"] = {
    registry: modelRegistry, keys: keyStore,
    list: providerView,
    add: (provider, key) => { keyStore.write(provider, key); return providerView(); },
    remove: (provider) => { keyStore.remove(provider); return providerView(); },
    verify: async (provider) => {
      // A free call, and only that: the models-list endpoint, never a completion.
      const r = await verifyKey(provider, modelRegistry, keyStore, async (url, init) => {
        const res = await fetch(url, { headers: init.headers, method: "GET" });
        return { ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> };
      });
      return { ok: r.ok, models: r.models, reason: r.reason };
    },
    firstRun: () => !existsSync(firstRunMarker),
    finishFirstRun: () => { writeFileSync(firstRunMarker, String(Date.now())); },
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
  const spend = new SpendLedger(graph.db, config.budget);
  const gatedBrain = makeGatedBrain(config, spend);
  const queue = new TaskQueue(graph.db, { concurrency: 3 });
  const rebuild = new RebuildRunner(graph, router);
  const validation = new ValidationRunner(graph, env);
  const readiness = new ReadinessEvaluator(graph, loadProfiles(paths.projectRoot));
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

  const browser = new BrowserShell(window, webRisk);
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
      version: "0.1.0", brainIsMock: brain.isMock, brainModel: brain.model, capabilities,
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

  return {
    graph, models, queue, broker, sessions, metrics, compute, workflows, webRisk, router, brain, gatedBrain, spend, config, env, browser, preview,
    rebuild, validation, readiness, sense,
    detailOf, historyOf, thinkingMap,
    impactOf: impactOfObject, passageOf,
    packageOf: (objectId, outPath) => exportPackage(graph, objectId, outPath)
      .then((r) => ({ path: r.path, bytes: r.bytes })),
    systemInfo, lineage,
    async dispose() {
      metrics.end();
      browser.closeAll();
      preview.stopAll();
      await queue.stop();
      graph.close();
    },
  };
}
