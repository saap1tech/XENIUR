import { contextBridge, ipcRenderer } from "electron";

/**
 * The bridge.
 *
 * One explicit method per capability — never `ipcRenderer` itself, and never a generic
 * invoke(channel, payload) passthrough, which would hand the renderer every channel at
 * once and make the main process's allowlist meaningless. This is the shape Electron's
 * context-isolation guidance recommends, and it is the only reason the renderer can be
 * sandboxed with node integration off and still do anything.
 *
 * Remote pages and generated code get no preload at all, so window.xeniur is simply
 * undefined inside them.
 */
const call = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

contextBridge.exposeInMainWorld("xeniur", {
  worlds: {
    list: () => call("worlds:list"),
    create: (input: { title: string; emoji: string; summary?: string }) => call("worlds:create", input),
    open: (worldId: string) => call("worlds:open", { id: worldId }),
  },
  objects: {
    get: (objectId: string) => call("objects:get", { id: objectId }),
    representations: (objectId: string) => call("objects:representations", { id: objectId }),
    lineage: (representationId: string) => call("objects:lineage", { id: representationId }),
    undo: (objectId: string) => call("objects:undo", { id: objectId }),
    redo: (objectId: string) => call("objects:redo", { id: objectId }),
  },
  intent: {
    submit: (input: { worldId: string; utterance: string; selection?: string[] }) =>
      call("intent:submit", input),
  },
  gestures: {
    choose: (input: Record<string, unknown>) => call("gestures:choose", input),
  },
  tasks: {
    active: () => call("tasks:active"),
    approve: (taskId: string) => call("tasks:approve", { id: taskId }),
    reject: (taskId: string) => call("tasks:reject", { id: taskId }),
    cancel: (taskId: string) => call("tasks:cancel", { id: taskId }),
    onEvent: (handler: (event: unknown, task: unknown) => void) => {
      const listener = (_e: unknown, payload: { event: unknown; task: unknown }) =>
        handler(payload.event, payload.task);
      ipcRenderer.on("xeniur:task-event", listener);
      return () => { ipcRenderer.removeListener("xeniur:task-event", listener); };
    },
  },
  browser: {
    open: (url: string) => call("browser:open", { url }),
    navigate: (viewId: string, url: string) => call("browser:navigate", { viewId, url }),
    setBounds: (viewId: string, rect: { x: number; y: number; width: number; height: number }) => {
      void call("browser:setBounds", { viewId, rect });
    },
    close: (viewId: string) => call("browser:close", { viewId }),
    status: (viewId: string) => call("browser:status", { viewId }),
  },
  web: {
    settings: () => call("web:settings"),
    setRiskMode: (mode: "local_only" | "google_lookup") => call("web:setRiskMode", { mode }),
    explore: (worldId: string, url: string) => call("web:explore", { worldId, url }),
  },
  economy: {
    snapshot: () => call("economy:snapshot"),
    confirm: (quoteId: string) => call("economy:confirm", { quoteId }),
    cancel: (quoteId: string) => call("economy:cancel", { quoteId }),
  },
  workflows: {
    list: () => call("workflows:list"),
    apply: (id: string) => call("workflows:apply", { id }),
  },
  code: {
    files: (objectId: string) => call("code:files", { id: objectId }),
    run: (objectId: string) => call("code:run", { id: objectId }),
    stop: (objectId: string) => call("code:stop", { id: objectId }),
  },
  blobs: {
    // Content addresses are resolved by the main process's own protocol handler.
    url: (blobHash: string) => `xeniur-blob://asset/${blobHash}`,
  },
  system: { info: () => call("system:info") },

  living: {
    detail: (objectId: string) => call("living:detail", { id: objectId }),
    validate: (objectId: string) => call("living:validate", { id: objectId }),
    rebuild: (objectId: string, includeGeneration: boolean) =>
      call("living:rebuild", { id: objectId, includeGeneration }),
    release: (objectId: string, profileId: string, note?: string) =>
      call("living:release", { id: objectId, profileId, note }),
    switchBranch: (objectId: string, branchId: string) =>
      call("living:switchBranch", { id: objectId, branchId }),
    importFiles: (paths: string[], input: { worldId: string; objectId?: string | null }) =>
      call("living:import", { paths, worldId: input.worldId, objectId: input.objectId ?? null }),
    exportPackage: (objectId: string) => call("living:export", { id: objectId }),
    impact: (objectId: string) => call("living:impact", { id: objectId }),
  },

  models: {
    list: () => call("models:list"),
    add: (provider: string, key: string) => call("models:add", { provider, key }),
    remove: (provider: string) => call("models:remove", { provider }),
    verify: (provider: string) => call("models:verify", { provider }),
    finishFirstRun: () => call("models:finishFirstRun"),
  },

  decisions: {
    list: (worldId: string) => call("decisions:list", { id: worldId }),
    get: (objectId: string) => call("decisions:get", { id: objectId }),
    create: (input: Record<string, unknown>) => call("decisions:create", input),
    cite: (objectId: string, evidence: Record<string, unknown>) =>
      call("decisions:cite", { id: objectId, ...evidence }),
    assume: (objectId: string, assumption: Record<string, unknown>) =>
      call("decisions:assume", { id: objectId, ...assumption }),
    accept: (objectId: string, answer?: { steelman?: string; reviewTrigger?: string; skipSteelman?: boolean }) =>
      call("decisions:accept", { id: objectId, ...(answer ?? {}) }),
    reaffirm: (objectId: string) => call("decisions:reaffirm", { id: objectId }),
    passage: (atomObjectId: string) => call("decisions:passage", { id: atomObjectId }),
    influence: (objectId: string, releaseId?: string) =>
      call("decisions:influence", { id: objectId, releaseId }),
  },

  constraints: {
    list: (worldId: string) => call("constraints:list", { id: worldId }),
    setValue: (objectId: string, value: unknown) => call("constraints:setValue", { id: objectId, value }),
  },

  process: {
    proof: (objectId: string) => call("process:proof", { id: objectId }),
    publish: (objectId: string, privacy?: "filtered" | "public") =>
      call("process:publish", { id: objectId, privacy }),
    exportPage: (input: { objectId: string; eventIds: string[]; discloseHashes: boolean; discloseTiming: boolean }) =>
      call("process:exportPage", { id: input.objectId, eventIds: input.eventIds,
        discloseHashes: input.discloseHashes, discloseTiming: input.discloseTiming }),
  },

  metrics: {
    record: (kind: "gesture_used" | "typed_instead", concept: string) =>
      call("metrics:record", { kind, concept }),
  },

  sense: {
    map: (worldId: string) => call("sense:map", { id: worldId }),
    friction: (worldId: string) => call("sense:friction", { id: worldId }),
    dismissFriction: (worldId: string, reason?: string) =>
      call("sense:dismissFriction", { id: worldId, reason }),
    capture: (input: Record<string, unknown>) => call("sense:capture", input),
    observe: (worldId: string, text: string, about?: string) =>
      call("sense:observe", { worldId, text, about }),
    sort: (objectId: string, lane: string) => call("sense:sort", { id: objectId, lane }),
    rate: (objectId: string, confidence: number | null) =>
      call("sense:rate", { id: objectId, confidence }),
    link: (input: Record<string, unknown>) => call("sense:link", input),
  },
});
