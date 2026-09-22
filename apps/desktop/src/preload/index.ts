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
    setAiProcessing: (objectId: string, mode: string) => call("objects:setAiProcessing", { id: objectId, mode }),
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
    profiles: () => call("browser:profiles"),
    createProfile: (label: string, kind: string) => call("browser:createProfile", { label, kind }),
    removeProfile: (profileId: string) => call("browser:removeProfile", { profileId }),
    openTab: (input: Record<string, unknown>) => call("browser:openTab", input),
    tabs: (worldId?: string | null) => call("browser:tabs", worldId === undefined ? {} : { worldId }),
    activate: (tabId: string) => call("browser:activate", { tabId }),
    navigate: (tabId: string, url: string) => call("browser:navigate", { tabId, url }),
    back: (tabId: string) => call("browser:back", { tabId }),
    forward: (tabId: string) => call("browser:forward", { tabId }),
    reload: (tabId: string) => call("browser:reload", { tabId }),
    find: (tabId: string, text: string) => call("browser:find", { tabId, text }),
    setBounds: (tabId: string, rect: { x: number; y: number; width: number; height: number }) => { void call("browser:setBounds", { tabId, rect }); },
    closeTab: (tabId: string) => call("browser:closeTab", { tabId }),
    state: (tabId: string) => call("browser:state", { tabId }),
    snapshot: (tabId: string) => call("browser:snapshot", { tabId }),
    takeOver: (tabId: string) => call("browser:takeOver", { tabId }),
    downloads: () => call("browser:downloads"),
    decideDownload: (id: string, decision: "kept" | "discarded") => call("browser:decideDownload", { id, decision }),
    onEvent: (handler: (payload: { tabId: string }) => void) => {
      const listener = (_e: unknown, payload: { tabId: string }) => handler(payload);
      ipcRenderer.on("xeniur:browser-event", listener);
      return () => { ipcRenderer.removeListener("xeniur:browser-event", listener); };
    },
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
  system: {
    info: () => call("system:info"),
    availability: () => call("system:availability"),
  },

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

  modes: {
    describe: (kind: string, envelope: Record<string, unknown>) => call("modes:describe", { kind, envelope }),
    start: (kind: string, envelope: Record<string, unknown>, sheetDigest: string, worldId?: string | null) =>
      call("modes:start", { kind, envelope, sheetDigest, worldId: worldId ?? null }),
    exit: (modeId: string, reason: string) => call("modes:exit", { id: modeId, reason }),
    active: () => call("modes:active"),
    restrictions: () => call("modes:restrictions"),
  },
  arena: {
    feeds: () => call("arena:feeds"),
    addFeed: (url: string, label: string) => call("arena:addFeed", { url, label }),
    removeFeed: (url: string) => call("arena:removeFeed", { url }),
    refresh: () => call("arena:refresh"),
    exportChallenge: (worldId: string) => call("challenges:export", { id: worldId }),
    adoptChallengeFile: (path: string) => call("challenges:adoptFile", { path }),
    issueTicket: (worldId: string, participant: { publicKey: string; displayName: string }, expiresAt: number) => call("tickets:issue", { worldId, participant, expiresAt }),
    adoptTicketFile: (path: string) => call("tickets:adoptFile", { path }),
    ticketHeld: (worldId: string) => call("tickets:held", { id: worldId }),
  },
  judging: {
    status: (worldId: string) => call("judging:status", { id: worldId }),
    judges: (worldId: string) => call("judging:judges", { id: worldId }),
    isJudge: (worldId: string) => call("judging:isJudge", { id: worldId }),
    invite: (worldId: string, judge: { publicKey: string; displayName: string }) => call("judging:invite", { worldId, judge }),
    open: (worldId: string) => call("judging:open", { id: worldId }),
    sheet: (worldId: string, entryId: string) => call("judging:sheet", { worldId, entryId }),
    assess: (worldId: string, entryId: string, criteria: unknown[], note: string) => call("judging:assess", { worldId, entryId, criteria, note }),
    assessments: (worldId: string) => call("judging:assessments", { id: worldId }),
    exportAssessment: (assessmentId: string) => call("judging:exportAssessment", { id: assessmentId }),
    adoptFile: (path: string) => call("judging:adoptFile", { path }),
    publishResults: (worldId: string, placings: unknown[], note: string) => call("judging:publishResults", { worldId, placings, note }),
    results: (worldId: string) => call("judging:results", { id: worldId }),
    exportResults: (worldId: string) => call("judging:exportResults", { id: worldId }),
  },
  position: {
    save: (input: Record<string, unknown>) => call("position:save", input),
    get: (worldId: string) => call("position:get", { id: worldId }),
  },
  plans: {
    current: (goalId: string) => call("plans:current", { id: goalId }),
    propose: (goalId: string) => call("plans:propose", { id: goalId }),
    adoptAll: (goalId: string) => call("plans:adoptAll", { id: goalId }),
    setDisposition: (goalId: string, stepId: string, disposition: string) => call("plans:setDisposition", { goalId, stepId, disposition }),
    edit: (goalId: string, stepId: string, patch: Record<string, unknown>) => call("plans:edit", { goalId, stepId, ...patch }),
    reorder: (goalId: string, order: string[]) => call("plans:reorder", { goalId, order }),
    addStep: (goalId: string, input: Record<string, unknown>) => call("plans:addStep", { goalId, ...input }),
    replaceStep: (goalId: string, stepId: string, input: Record<string, unknown>) => call("plans:replaceStep", { goalId, stepId, ...input }),
    setInputs: (goalId: string, stepId: string, objectIds: string[]) => call("plans:setInputs", { goalId, stepId, objectIds }),
    setExecution: (goalId: string, stepId: string, execution: string, note?: string) => call("plans:setExecution", { goalId, stepId, execution, ...(note !== undefined ? { note } : {}) }),
    attachEvidence: (goalId: string, stepId: string, evidence: Record<string, unknown>) => call("plans:attachEvidence", { goalId, stepId, evidence }),
    work: (goalId: string) => call("plans:work", { id: goalId }),
  },
  seal: {
    active: () => call("seal:active"),
    beat: (modeId: string, focusObjectId: string | null, versionId: string | null) => call("seal:beat", { modeId, focusObjectId, versionId }),
    facts: (entryObjectId: string) => call("seal:facts", { id: entryObjectId }),
    paste: (objectId: string, versionId: string | null, chars: number, sourceObjectId?: string | null) =>
      call("seal:paste", { objectId, versionId, chars, sourceObjectId: sourceObjectId ?? null }),
  },
  rhythm: {
    offer: (worldId: string, objectId: string | null) => call("rhythm:offer", { worldId, objectId }),
    resolve: (offerId: string, outcome: string) => call("rhythm:resolve", { id: offerId, outcome }),
    streak: () => call("rhythm:streak"),
  },

  packages: {
    inspect: (path: string) => call("packages:inspect", { path }),
    import: (path: string, input: { as: string; worldId?: string | null }) =>
      call("packages:import", { path, as: input.as, worldId: input.worldId ?? null }),
  },

  challenges: {
    list: () => call("challenges:list"),
    get: (worldId: string) => call("challenges:get", { id: worldId }),
    matching: () => call("challenges:matching"),
    dismiss: (worldId: string) => call("challenges:dismiss", { id: worldId }),
    create: (rules: Record<string, unknown>) => call("challenges:create", { rules }),
    enter: (worldId: string, objectId: string) => call("challenges:enter", { worldId, objectId }),
    entries: (worldId: string) => call("challenges:entries", { id: worldId }),
    evaluate: (worldId: string, objectId: string) => call("challenges:evaluate", { worldId, objectId }),
  },

  outreach: {
    describe: (envelope: Record<string, unknown>) => call("outreach:describe", { envelope }),
    create: (worldId: string, envelope: Record<string, unknown>, digest: string) =>
      call("outreach:create", { worldId, envelope, digest }),
    send: (campaignId: string, message: Record<string, unknown>) => call("outreach:send", { id: campaignId, message }),
    list: (worldId: string) => call("outreach:list", { id: worldId }),
    revoke: (campaignId: string) => call("outreach:revoke", { id: campaignId }),
    transportConfigured: () => call("outreach:transportConfigured"),
  },

  publishers: {
    self: () => call("publishers:self"),
    list: () => call("publishers:list"),
    setTrust: (publicKey: string, displayName: string, level: string) =>
      call("publishers:setTrust", { publicKey, displayName, level }),
    report: (publicKey: string, displayName: string, reason: string, note?: string) =>
      call("publishers:report", { publicKey, displayName, reason, note: note ?? "" }),
  },

  goals: {
    current: (worldId: string) => call("goals:current", { id: worldId }),
    create: (worldId: string, outcome: string, focusObjectId?: string | null) =>
      call("goals:create", { worldId, outcome, focusObjectId: focusObjectId ?? null }),
    setStatus: (goalId: string, status: string) => call("goals:setStatus", { id: goalId, status }),
    finish: (goalId: string, anyway?: { because: string }) => call("goals:finish", { id: goalId, ...(anyway ? { anyway } : {}) }),
    setRequiredOutputs: (goalId: string, outputs: string[]) => call("goals:setRequiredOutputs", { id: goalId, outputs }),
    setOutcome: (goalId: string, outcome: string) => call("goals:setOutcome", { id: goalId, outcome }),
    setFocus: (goalId: string, objectId: string | null) => call("goals:setFocus", { id: goalId, objectId }),
    addNextAction: (goalId: string, text: string, objectId?: string | null) =>
      call("goals:addNextAction", { id: goalId, text, objectId: objectId ?? null }),
    doneNextAction: (goalId: string, actionId: string) => call("goals:doneNextAction", { id: goalId, actionId }),
    relevant: (goalId: string) => call("goals:relevant", { id: goalId }),
    standing: (goalId: string) => call("goals:standing", { id: goalId }),
  },

  today: {
    get: () => call("today:get"),
  },

  trust: {
    facts: (objectId: string) => call("trust:facts", { id: objectId }),
    world: (worldId: string) => call("trust:world", { id: worldId }),
    supportMap: (objectId: string) => call("trust:supportMap", { id: objectId }),
    auditExport: (objectId: string) => call("trust:auditExport", { id: objectId }),
    outcome: (objectId: string, releaseId?: string) => call("trust:outcome", { id: objectId, releaseId }),
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
    reviewSupport: (supportId: string, status: string, note?: string) =>
      call("sense:reviewSupport", { id: supportId, status, note: note ?? "" }),
    pendingCandidates: (worldId: string) => call("sense:pendingCandidates", { id: worldId }),
    basis: (claimObjectId: string) => call("sense:basis", { id: claimObjectId }),
    connections: (objectId: string) => call("sense:connections", { id: objectId }),
    acceptCandidate: (candidateId: string, edit?: { acceptUnreviewed?: boolean }) =>
      call("sense:acceptCandidate", { id: candidateId, acceptUnreviewed: edit?.acceptUnreviewed ?? false }),
    rejectCandidate: (candidateId: string) => call("sense:rejectCandidate", { id: candidateId }),
  },

  brain: {
    resolve: (utterance: string, selection: string[]) => call("brain:resolve", { utterance, selection }),
    prepare: (input: { worldId: string; objectId: string; intent: string; question: string }) => call("brain:prepare", input),
    ask: (input: { trailId: string; contextDigest: string; planDigest: string }) => call("brain:ask", input),
    trail: (objectId: string) => call("brain:trail", { id: objectId }),
  },
});
