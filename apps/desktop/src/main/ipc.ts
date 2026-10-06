import { app, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractCandidates } from "@xeniur/sensemaking";
import { z } from "zod";
import { ChallengeRulesSchema, ExitReasonSchema, GoalStatusSchema, ModeEnvelopeSchema, ModeKindSchema, OutreachEnvelopeSchema, PublisherRefSchema, ReportReasonSchema, TrustLevelSchema, authorizeFor, campaignPlan, campaignScope, describeEnvelope, describeRecipients, needsCampaign, planDigest, sha256Hex, UuidSchema, type ActionPlan, type FinishResult, type IntentResult, type WorldSnapshot } from "@xeniur/core";
import { NotComplete, NotFinishable, connectionsFor, contextMaterialFor, finishGoal, standingFor, importPackage, inspectPackage, outcomeOf, renderAuditPage, renderProofPage, supportMapFor, todayFor, trustFactsFor, trustFactsForWorld } from "@xeniur/graph";
import { compileContext } from "@xeniur/grammar";
import { policyFrom } from "@xeniur/models";
import { proposeFromBound } from "@xeniur/sensemaking";
import { SupportStatusSchema, type Tool, type PlanShape } from "@xeniur/core";
import { ActionRequestSchema, ProfileKindSchema, RightsSchema, CriterionMarkSchema, PlacingSchema, SignedDocumentEnvelopeSchema, StepDispositionSchema, StepEvidenceSchema, StepExecutionSchema, StepKindSchema, type StepWork } from "@xeniur/core";
import { policyConstraints } from "./services.js";
import { BrainIntentSchema, InvalidPlanError, bindProposal, resolveAsk, type BrainIntent } from "@xeniur/brain";
import { planForProposal, proposalsFor } from "@xeniur/grammar";
import type { Services } from "./services.js";
import { assertTrustedSender, UntrustedSenderError } from "./security.js";
import { captureWeb } from "./web/capture.js";
import { exploreIntoProposals } from "./web/explore.js";
import { runtimeAvailability } from "./availability.js";
import { fetchArenaFeed } from "./web/arena.js";
import { generationFingerprint, verifiedGenerationPrice } from "./economy.js";
import { SharpenAnswerSchema } from "@xeniur/core";
import { JourneyCommandSchema, JourneyKindSchema, PATH_CATALOG } from "@xeniur/core";
import { readResource, cropPdfFigure, MAX_RESOURCE_BYTES } from "./journey/resources.js";
import { exportJourney } from "./journey/document.js";
import { appPaths } from "./paths.js";
import { WorkStateStore } from "@xeniur/graph";

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
  "journey:get": Uuid,
  "journey:cancel": Uuid,
  "journey:insights": Uuid,
  "journey:passage": z.object({worldId:UuidSchema,versionId:UuidSchema,passageId:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  "journey:start": z.object({ worldId: UuidSchema, kind: JourneyKindSchema }).strict(),
  "journey:quote": JourneyCommandSchema,
  "journey:act": JourneyCommandSchema,
  "journey:upload": z.object({ worldId: UuidSchema, versionId: UuidSchema }).strict(),
  "journey:addNote": z.object({ worldId: UuidSchema, versionId: UuidSchema, title: z.string().trim().min(1).max(160), text: z.string().trim().min(8).max(300000) }).strict(),
  "journey:addUrl": z.object({ worldId: UuidSchema, versionId: UuidSchema, url: z.string().url().max(4000) }).strict(),
  "journey:sourcePage": z.object({ worldId: UuidSchema, versionId: UuidSchema, resourceId: UuidSchema, page: z.number().int().min(1).max(2000) }).strict(),
  "journey:useObject": z.object({ worldId: UuidSchema, versionId: UuidSchema, objectId: UuidSchema }).strict(),
  "objects:readText": Uuid,
  "journey:sourceFigure": z.object({ worldId: UuidSchema, versionId: UuidSchema, resourceId: UuidSchema, page: z.number().int().min(1).max(2000),
    crop: z.object({ x: z.number().min(0).max(.99), y: z.number().min(0).max(.99), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine(c=>c.x+c.width<=1&&c.y+c.height<=1),
    caption: z.string().trim().min(1).max(400), permission: z.literal(true) }).strict(),
  "journey:export": z.object({ worldId: UuidSchema, versionId: UuidSchema }).strict(),
  "workState:assess": Uuid,
  "workState:session": Uuid,
  "workState:start": z.object({ goalId: UuidSchema, objectId: UuidSchema.nullable(), signalId: z.string().min(1).max(100).nullable(),depth:z.enum(["focused","full"]).optional() }).strict(),
  "workState:answer": SharpenAnswerSchema,
  "worlds:list": z.undefined(),
  "worlds:covers": z.object({ worldIds: z.array(UuidSchema).max(9) }),
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
    targetKind: z.enum(["claim", "object", "print", "delivery", "version", "question_lane", "decision", "work", "requirement"]),
    label: z.string().min(1).max(100),
  }),
  "tasks:active": z.undefined(),
  "tasks:approve": Uuid,
  "tasks:reject": Uuid,
  "tasks:cancel": Uuid,
  "browser:setFullscreen": z.object({enabled:z.boolean()}).strict(),
  "browser:profiles": z.undefined(),
  "browser:createProfile": z.object({ label: z.string().min(1).max(60), kind: ProfileKindSchema }),
  "browser:removeProfile": z.object({ profileId: z.string().min(1) }),
  "browser:openTab": z.object({ profileId: z.string().min(1), url: z.string().url(), worldId: UuidSchema.nullable().default(null),
    goalId: UuidSchema.nullable().default(null), stepId: z.string().nullable().default(null) }),
  "browser:tabs": z.object({ worldId: UuidSchema.nullable().optional() }),
  "browser:compare":z.object({tabId:z.string().min(1),otherId:z.string().min(1).nullable()}).strict(),
  "browser:shelf":z.object({worldId:UuidSchema}).strict(),
  "browser:activate": z.object({ tabId: z.string().min(1) }),
  "browser:navigate": z.object({ tabId: z.string().min(1), url: z.string().url() }),
  "browser:back": z.object({ tabId: z.string().min(1) }),
  "browser:forward": z.object({ tabId: z.string().min(1) }),
  "browser:reload": z.object({ tabId: z.string().min(1) }),
  "browser:find": z.object({ tabId: z.string().min(1), text: z.string().max(200) }),
  "browser:setBounds": z.object({ tabId: z.string().min(1), rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }) }),
  "browser:closeTab": z.object({ tabId: z.string().min(1) }),
  "browser:state": z.object({ tabId: z.string().min(1) }),
  "browser:snapshot": z.object({ tabId: z.string().min(1) }),
  "browser:takeOver": z.object({ tabId: z.string().min(1) }),
  "browser:downloads":z.object({worldId:UuidSchema.nullable().optional()}),
  "browser:decideDownload": z.object({ id: z.string().min(1), decision: z.enum(["kept", "discarded"]) }),
  "web:settings": z.undefined(),
  "web:setRiskMode": z.object({ mode: z.enum(["local_only", "google_lookup"]) }),
  "web:explore": z.object({ worldId: UuidSchema, url: z.string().url().max(4000) }),
  "economy:snapshot": z.undefined(),
  "economy:confirm": z.object({ quoteId: UuidSchema }),
  "economy:cancel": z.object({ quoteId: UuidSchema }),
  "workflows:list": z.undefined(),
  "workflows:apply": z.object({ id: z.string().min(1).max(128) }),
  "code:setBounds": z.object({id: z.string().uuid(), rect:z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().min(0),height:z.number().finite().min(0)})}),
  "code:files": Uuid,
  "code:run": Uuid,
  "code:stop": Uuid,
  "system:info": z.undefined(),
  "system:availability": z.undefined(),

  /* Living Objects */
  "living:detail": Uuid,
  "living:validate": Uuid,
  "living:rebuild": z.object({ id: UuidSchema, includeGeneration: z.boolean().default(false) }),
  "living:release": z.object({ id: UuidSchema, profileId: z.string().min(1), note: z.string().max(2000).optional() }),
  "living:switchBranch": z.object({ id: UuidSchema, branchId: UuidSchema }),
  "living:import": z.object({
    paths: z.array(z.string().min(1)).min(1).max(32),
    worldId: UuidSchema,
    objectId: UuidSchema.nullable().optional(),
  }),
  "living:pickSource": Uuid,
  "living:saveForm": z.object({id:UuidSchema,role:z.string().min(1).max(100)}).strict(),
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
  "rhythm:breakpoint": z.object({ worldId: UuidSchema, objectId: UuidSchema.nullable() }),
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
  "publishers:report": PublisherRefSchema.extend({ reason: ReportReasonSchema, note: z.string().max(2000) }),
  "goals:current": Uuid,
  "goals:create": z.object({ worldId: UuidSchema, outcome: z.string().min(1).max(2000), focusObjectId: UuidSchema.nullable() }),
  // Finished is not a status one can set: it is the outcome of goals:finish.
  "goals:setStatus": z.object({ id: UuidSchema, status: GoalStatusSchema.exclude(["finished"]) }),
  "goals:finish": z.object({ id: UuidSchema, anyway: z.object({ because: z.string().min(8).max(2000) }).optional() }),
  "goals:setOutcome": z.object({ id: UuidSchema, outcome: z.string().min(1).max(2000) }),
  "goals:setFocus": z.object({ id: UuidSchema, objectId: UuidSchema.nullable() }),
  "goals:addNextAction": z.object({ id: UuidSchema, text: z.string().min(1).max(200), objectId: UuidSchema.nullable() }),
  "goals:doneNextAction": z.object({ id: UuidSchema, actionId: z.string().min(1) }),
  "goals:relevant": Uuid,
  "goals:setRequiredOutputs": z.object({ id: UuidSchema, outputs: z.array(z.string().min(1)).max(12) }),
  "position:save": z.object({ worldId: UuidSchema, goalId: UuidSchema.nullable().default(null), planRevision: z.number().int().positive().nullable().default(null),
    stepId: z.string().nullable().default(null), objectId: UuidSchema.nullable().default(null), formRole: z.string().nullable().default(null),
    zone: z.enum(["sources", "decisions", "work", "deliveries"]).nullable().default(null), tabIds: z.array(z.string().min(1)).max(32).default([]), pendingReviewId: z.string().nullable().default(null) }),
  "position:get": Uuid,
  "actions:draft": z.object({ worldId: UuidSchema, goalId: UuidSchema.nullable().default(null), stepId: z.string().nullable().default(null),
    adapterId: z.string().min(1), request: ActionRequestSchema }),
  "actions:approve": z.object({ actionId: UuidSchema, accountLabel: z.string().max(200).nullable().default(null), minutes: z.number().int().positive().max(240).default(30) }),
  "actions:dispatch": z.object({ actionId: UuidSchema }),
  "actions:checkStatus": z.object({ attemptId: UuidSchema }),
  "actions:list": Uuid,
  "actions:get": Uuid,
  "actions:discard": z.object({ actionId: UuidSchema }),
  "routes:list": z.undefined(),
  "routes:setToken": z.object({ routeId: z.string().min(1), token: z.string().min(1).max(4000) }),
  "routes:removeToken": z.object({ routeId: z.string().min(1) }),
  "plans:current": Uuid,
  "plans:propose": Uuid,
  "plans:adoptAll": Uuid,
  "plans:setDisposition": z.object({ goalId: UuidSchema, stepId: z.string().min(1), disposition: StepDispositionSchema }),
  "plans:edit": z.object({ goalId: UuidSchema, stepId: z.string().min(1), purpose: z.string().min(1).max(200).optional(), expectedResult: z.string().max(300).optional(), kind: StepKindSchema.optional() }),
  "plans:reorder": z.object({ goalId: UuidSchema, order: z.array(z.string().min(1)).max(24) }),
  "plans:addStep": z.object({ goalId: UuidSchema, kind: StepKindSchema, purpose: z.string().min(1).max(200), expectedResult: z.string().max(300).optional(), after: z.string().nullable().optional() }),
  "plans:replaceStep": z.object({ goalId: UuidSchema, stepId: z.string().min(1), kind: StepKindSchema, purpose: z.string().min(1).max(200), expectedResult: z.string().max(300).optional() }),
  "plans:setInputs": z.object({ goalId: UuidSchema, stepId: z.string().min(1), objectIds: z.array(UuidSchema).max(24) }),
  "plans:setExecution": z.object({ goalId: UuidSchema, stepId: z.string().min(1), execution: StepExecutionSchema, note: z.string().max(1000).optional() }),
  "plans:attachEvidence": z.object({ goalId: UuidSchema, stepId: z.string().min(1), evidence: StepEvidenceSchema }),
  "plans:work": Uuid,
  "goals:standing": Uuid,
  "today:get": z.undefined(),
  "trust:facts": Uuid,
  "trust:world": Uuid,
  "trust:supportMap": Uuid,
  "trust:auditExport": Uuid,
  "trust:outcome": z.object({ id: UuidSchema, releaseId: UuidSchema.optional() }),
  "process:proof": Uuid,
  "process:publish": z.object({ id: UuidSchema, privacy: z.enum(["filtered", "public"]).default("filtered") }),
  "process:exportPage": z.object({ id: UuidSchema, eventIds: z.array(UuidSchema).max(2000),
    discloseHashes: z.boolean(), discloseTiming: z.boolean(), humanPass: z.object({
      changed: z.string().trim().min(1).max(2000), standBehind: z.string().trim().min(1).max(2000),
      checkNext: z.string().trim().min(1).max(2000),
    }) }),
  "metrics:record": z.object({
    kind: z.enum(["gesture_used", "typed_instead"]),
    concept: z.enum(["where", "when", "who", "cost", "quantity", "priority", "sequence", "relationship"]),
  }),

  /* Sensemaking */
  "sense:map": Uuid,
  "sense:friction": Uuid,
  "sense:dismissFriction": z.object({ id: UuidSchema, reason: z.string().max(2000).optional() }),
  "sense:capture": z.object({
    worldId: UuidSchema,
    kind: z.enum(["article", "video", "podcast", "paper", "note", "conversation", "screenshot", "clip", "book"]),
    title: z.string().min(1).max(300),
    text: z.string().min(1).max(200_000),
    url: z.string().url().optional(),
    author: z.string().max(200).optional(),
    /** Which visible tab this came from, and under whose account. Never a fresh public fetch. */
    sourceIdentity: z.object({ tabId: z.string().min(1), profileLabel: z.string().max(60) }).optional(),
    /** What the person may do with it. Unknown by default: being able to read is not a licence. */
    permittedUse: RightsSchema.default("unknown"),
    /** The person said not to send it to a model, at the moment of saving. */
    aiProcessing: z.enum(["allowed", "never"]).default("allowed"),
    journeyVersionId:UuidSchema.optional(),
  }),
  "sense:observe": z.object({ worldId: UuidSchema, text: z.string().min(1).max(4000), about: UuidSchema.optional() }),
  "sense:sort": z.object({ id: UuidSchema, lane: z.enum(["keep", "question", "connect", "test", "build", "ignore"]) }),
  "sense:rate": z.object({ id: UuidSchema, confidence: z.number().min(0).max(1).nullable() }),
  "sense:link": z.object({
    fromObjectId: UuidSchema, toObjectId: UuidSchema,
    relation: z.enum(["supports", "contradicts", "example_of", "asks_about", "same_as", "derived_from"]),
    note: z.string().max(2000).optional(),
  }),

  "sense:reviewSupport": z.object({ id: UuidSchema, status: SupportStatusSchema, note: z.string().max(2000) }),
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
    provider: z.literal("openrouter"),
    key: z.string().min(8).max(512),
  }),
  "models:remove": z.object({ provider: z.literal("openrouter") }),
  "models:verify": z.object({ provider: z.literal("openrouter") }),
  "models:select": z.object({ modelId: z.string().min(1).max(120), selected: z.boolean() }),
  "models:budget": z.undefined(),
  "models:setBudget": z.object({ perActionUsdMax: z.number().positive().max(5), monthlyUsdMax: z.number().positive().max(10000) }),
  "models:finishFirstRun": z.undefined(),

  /* Decisions */
  "decisions:list": Uuid,
  "decisions:get": Uuid,
  "decisions:create": z.object({
    worldId: UuidSchema,
    question: z.string().min(1).max(2000),
    options: z.array(z.object({
      key: z.string().min(1).max(60),
      label: z.string().min(1).max(200),
      note: z.string().max(2000).default(""),
    })).max(12).default([]),
    chosenOption: z.string().max(60).nullable().optional(),
    rationale: z.string().max(4000).optional(),
  }),
  "decisions:cite": z.object({
    id: UuidSchema,
    sourceVersionId: UuidSchema.nullable().optional(),
    atomObjectId: UuidSchema.nullable().optional(),
    relation: z.enum(["supports", "contradicts", "informed_by"]).default("informed_by"),
    note: z.string().max(2000).default(""),
  }),
  "decisions:assume": z.object({
    id: UuidSchema,
    text: z.string().min(1).max(1000),
    reviewTrigger: z.string().max(2000).default(""),
  }),
  "decisions:accept": z.object({
    id: UuidSchema,
    /** One reason this could be wrong. Either this or skipSteelman must be present. */
    steelman: z.string().max(1000).optional(),
    reviewTrigger: z.string().max(2000).optional(),
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
    "journey:get": ({id}) => services.journey.get(id),
    "journey:cancel": ({id}) => services.journey.cancel(id),
    "journey:insights": ({id}) => services.journey.insights(id),
    "journey:passage": ({worldId,versionId,passageId}) => services.journey.passage(worldId,versionId,passageId),
    "journey:start": ({worldId,kind}) => services.journey.start(worldId,kind),
    "journey:quote": (command) => services.journey.quote(command),
    "journey:act": (command) => services.journey.act(command),
    "journey:upload": async ({worldId,versionId}) => {
      const chosen = await dialog.showOpenDialog({ title:"Add resources", properties:["openFile","multiSelections"], filters:[{name:"Resources",extensions:["pdf","txt","md","csv","html"]}] });
      let journey = services.journey.get(worldId);
      if (!journey || journey.versionId !== versionId) throw new Error("Refresh this work path before adding material.");
      if (chosen.canceled) return journey;
      for (const path of chosen.filePaths) {
        if (statSync(path).size > MAX_RESOURCE_BYTES) throw new Error("Choose a resource smaller than 50 MB.");
        const reading = await readResource(readFileSync(path), path.split(/[\\/]/).pop()!, "");
        journey = services.journey.addResource(worldId,journey.versionId,reading);
      }
      return journey;
    },
    "journey:addNote": ({worldId,versionId,title,text}) => services.journey.addResource(worldId,versionId,{ title,text,raw:Buffer.from(text),pdf:false,partial:false,pages:0 }),
    "journey:addUrl": ({worldId,versionId,url}) => services.journey.addUrl(worldId,versionId,url),
    "objects:readText": ({id}) => {
      const state=services.graph.currentState(id);
      if(!state)throw new Error("This item is unavailable.");
      const sourceVersion=state.properties.settings["sourceVersionId"];
      if(typeof sourceVersion==="string") {
        const version=services.sense.getSourceVersion(sourceVersion);
        if(version) return {text:services.graph.readBlob(version.textBlobHash).toString("utf8").slice(0,300000),format:"txt",partial:version.partial};
      }
      const form=state.forms.find(f=>f.role==="doc.primary")??state.forms[0];
      const rep=form?services.graph.getRepresentation(form.representationId):null;
      if(!rep?.blobHash || !["txt","md","json","tex","html","csv"].includes(rep.format))return null;
      return {text:services.graph.readBlob(rep.blobHash).toString("utf8").slice(0,300000),format:rep.format,partial:false};
    },
    "journey:useObject": async ({worldId,versionId,objectId}) => {
      const state=services.graph.currentState(objectId);
      if(!state || state.object.worldId!==worldId || state.object.archivedAt)throw new Error("Choose a file in this project.");
      const originalSourceId=state.properties.settings["sourceId"];
      const original=typeof originalSourceId==="string"?services.sense.latestVersionOf(originalSourceId):null;
      if(state.properties.settings["aiProcessing"]==="never" || original?.rights==="restricted")throw new Error("Keep this private item outside the AI work path.");
      const form=state.forms.find(f=>["source.primary","doc.primary"].includes(f.role))??state.forms[0];
      const rep=form?services.graph.getRepresentation(form.representationId):null;
      if(!rep?.blobHash)throw new Error("This item has no file to read.");
      const reading=await readResource(services.graph.readBlob(rep.blobHash),`${state.properties.title}.${rep.format}`,rep.format==="pdf"?"application/pdf":`text/${rep.format}`);
      return services.journey.addResource(worldId,versionId,reading);
    },
    "journey:sourcePage": async ({worldId,versionId,resourceId,page}) => {
      const j=services.journey.get(worldId);if(!j||j.versionId!==versionId)throw new Error("Refresh the source preview.");
      const r=j.resources.find(r=>r.id===resourceId);if(!r?.blobHash||!r.pages)throw new Error("Choose a PDF.");
      const png=await cropPdfFigure(services.graph.readBlob(r.blobHash),page,{x:0,y:0,width:1,height:1});
      return services.graph.putBlob(png,"image/png","png");
    },
    "journey:sourceFigure": async ({worldId,versionId,resourceId,page,crop,caption}) => {
      const journey=services.journey.get(worldId);
      if(!journey || journey.versionId!==versionId)throw new Error("Refresh before selecting a source figure.");
      const r=journey.resources.find(r=>r.id===resourceId);
      if(!r?.blobHash || !r.pages)throw new Error("Choose an imported PDF.");
      const bytes=await cropPdfFigure(services.graph.readBlob(r.blobHash),page,crop);
      return services.journey.saveSourceFigure(worldId,versionId,resourceId,page,bytes,caption);
    },
    "journey:export": async ({worldId,versionId}) => {
      const journey=services.journey.validateExport(worldId,versionId);
      const target=await dialog.showSaveDialog({title:journey.flow?"Save work bundle":"Save review bundle",defaultPath:journey.flow?`xeniur-${journey.kind}.zip`:"xeniur-review.zip",filters:[{name:"Editable work bundle",extensions:["zip"]}]});
      if(target.canceled || !target.filePath)return null;
      services.journey.validateExport(worldId,versionId);
      const paths=appPaths();
      const result=await exportJourney(journey,services.graph,paths.projectRoot,paths.scratchDir,target.filePath);services.journey.recordOutcome(worldId,"exported");return result;
    },
    "worlds:list": () => services.graph.listWorlds(),
    "worlds:covers": ({ worldIds }): Record<string, string> => {
      const covers: Record<string, string> = {};
      for (const worldId of worldIds) {
        if (!services.graph.getWorld(worldId)) continue;
        const latest = services.graph.listStates(worldId)
          .flatMap((state) => services.graph.listRepresentations(state.object.id))
          .filter((rep) => rep.modality === "image" && rep.blobHash)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest?.blobHash) covers[worldId] = latest.blobHash;
      }
      return covers;
    },
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
      // A requirement is something the work must satisfy: a constraint, or an Object a goal in
      // this project named as a required output. Read from the graph, never from the caller.
      const isRequirement = Boolean(target) && (target!.properties.semanticType === "constraint"
        || services.graph.goals.history(worldId).some((g) => g.requiredOutputs.includes(targetId)));
      const expectedKind = target
        ? (services.graph.decisions.get(targetId) ? "decision"
          : isRequirement ? "requirement"
          : target.properties.semanticType === "claim" ? "claim" : "object")
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

    "browser:setFullscreen": ({enabled})=>services.browser.setFullscreen(enabled),
    "browser:profiles": () => services.browser.profiles(),
    "browser:createProfile": ({ label, kind }) => services.browser.createProfile(label, kind),
    "browser:removeProfile": ({ profileId }) => services.browser.removeProfile(profileId),
    "browser:openTab": (input) => services.browser.openTab(input),
    "browser:tabs": ({ worldId }) => services.browser.tabs(worldId),
    "browser:activate": ({ tabId }) => services.browser.activate(tabId),
    "browser:compare":({tabId,otherId})=>services.browser.compare(tabId,otherId),
    "browser:shelf":({worldId})=>{
      const journey=services.journey.get(worldId);
      return services.sense.listSources(worldId).slice(0,128).map(source=>{const version=services.sense.latestVersionOf(source.id);return {sourceId:source.id,title:source.title,url:source.url,at:source.retrievedAt,excerpt:version?services.graph.readBlob(version.textBlobHash).toString("utf8").slice(0,240):"",private:source.metadata["aiProcessing"]==="never"||version?.rights==="restricted",inPath:journey?.resources.some(r=>r.sourceVersionId===version?.id)??false};});
    },
    "browser:navigate": ({ tabId, url }) => services.browser.navigate(tabId, url),
    "browser:back": ({ tabId }) => { services.browser.back(tabId); },
    "browser:forward": ({ tabId }) => { services.browser.forward(tabId); },
    "browser:reload": ({ tabId }) => { services.browser.reload(tabId); },
    "browser:find": ({ tabId, text }) => { services.browser.find(tabId, text); },
    "browser:setBounds": ({ tabId, rect }) => { services.browser.setBounds(tabId, rect); },
    "browser:closeTab": ({ tabId }) => { services.browser.closeTab(tabId); },
    "browser:state": ({ tabId }) => services.browser.state(tabId),
    "browser:snapshot": ({ tabId }) => services.browser.snapshot(tabId),
    // Take over is the person's, always, and it needs no reason.
    "browser:takeOver": ({ tabId }) => { services.browser.takeOver(tabId); },
    "browser:downloads": ({worldId}) => services.browser.downloads(worldId),
    "browser:decideDownload": ({ id, decision }) => services.browser.decideDownload(id, decision),
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
      // Capture stores the copy and proposes; acceptance is a separate, recorded act in the tray.
      const { sourceId, candidateCount, contentHash } = exploreIntoProposals(services.sense, worldId, captured);
      return { sourceId, title: captured.title, url: captured.url,
        excerpt: captured.text.slice(0, 520), contentHash, risk: captured.risk, candidateCount };
    },
    "economy:snapshot": () => services.compute.snapshot(),
    "economy:confirm": ({ quoteId }) => services.compute.confirm(quoteId, (quote) => enqueuePlan(services, quote.worldId, quote.plan, quote.id)),
    "economy:cancel": ({ quoteId }) => { services.compute.cancel(quoteId); },
    "workflows:list": () => services.workflows.list(),
    "workflows:apply": ({ id }) => {
      if (!id.startsWith("path:")) return services.workflows.apply(id);
      const kind = JourneyKindSchema.parse(id.slice(5));
      const card = PATH_CATALOG.find(p => p.id === kind);
      return services.graph.db.transaction(() => {
        const world = services.graph.createWorld({title:card?.name ?? "Your own path",emoji:"◻",summary:card?.description ?? "A path around your work"});
        services.journey.start(world.id,kind);
        return world.id;
      })();
    },

    "code:setBounds": ({id,rect}) => {services.preview.setBounds(id,rect);},
    "code:files": ({ id }) => services.preview.files(id),
    "code:run": ({ id }) => {
      const rep = services.graph.listRepresentations(id).filter((r) => r.modality === "code").at(-1);
      if (!rep?.blobHash) throw new Error("this object has no project to run");
      services.preview.load(id, services.graph.readBlob(rep.blobHash));
      return services.preview.run(id);
    },
    "code:stop": ({ id }) => { services.preview.stop(id); },

    "system:info": () => services.systemInfo(),
    "system:availability": () => runtimeAvailability(services),

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
    "rhythm:breakpoint": ({ worldId, objectId }) => services.rhythm.offerAtBreakpoint({ worldId, objectId }),
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
      if (goal) services.metrics.record("goal_status_changed", { detail: { status } });
      return goal;
    },
    "goals:finish": ({ id, anyway }): FinishResult => {
      // The check decides; a person may finish anyway, and that is a Decision the report names.
      try {
        const goal = finishGoal(services.graph, id, anyway ? { anyway } : {});
        services.metrics.record("goal_finished", { detail: { anyway: Boolean(anyway) } });
        return { finished: true, goal };
      } catch (cause) {
        if (cause instanceof NotFinishable) return { finished: false, missing: cause.missing };
        throw cause;
      }
    },
    "goals:setOutcome": ({ id, outcome }) => services.graph.goals.setOutcome(id, outcome),
    "goals:setFocus": ({ id, objectId }) => services.graph.goals.setFocus(id, objectId),
    "goals:addNextAction": ({ id, text, objectId }) => services.graph.goals.addNextAction(id, { text, objectId }),
    "goals:doneNextAction": ({ id, actionId }) => services.graph.goals.doneNextAction(id, actionId),
    "goals:relevant": ({ id }) => services.graph.goals.relevantObjects(id),
    "goals:setRequiredOutputs": ({ id, outputs }) => {
      const goal = services.graph.goals.setRequiredOutputs(id, outputs);
      // A requirement changed under the plan: steps that pinned an older version need review.
      for (const output of outputs) if (services.graph.getObject(output)) services.graph.plans.onRequirementChanged(id, output);
      return goal;
    },
    "position:save": (input) => services.graph.positions.save(input),
    "position:get": ({ id }) => services.graph.positions.get(id),
    "actions:draft": ({ worldId, goalId, stepId, adapterId, request }) =>
      services.graph.delegated.draft({ worldId, goalId, stepId, adapterId, request }),
    "actions:approve": ({ actionId, accountLabel, minutes }) => {
      // The person approved this exact plan. The grant is issued here, in the trusted process,
      // bound to its digest, to this route and class, for one action and a bounded time.
      const a = services.graph.delegated.get(actionId);
      const grant = services.graph.grants.issue({
        kind: "action", route: a.route as "embedded_tab" | "service_api", worldId: a.worldId, goalId: a.goalId,
        tabId: a.request.tabId, origins: a.route === "embedded_tab" && a.description.destination.startsWith("http") ? [new URL(a.description.destination).origin] : [],
        accountLabel: accountLabel ?? a.description.accountLabel, accountVerifiedBy: accountLabel ? "person" : null,
        actionClasses: [a.request.actionClass], reviewDigest: a.reviewDigest,
        payloadVersionIds: a.request.items.map((i) => i.versionId).filter((v): v is string => v !== null),
        oneUse: true, limits: { maxActions: 1, maxAmount: a.request.amount, currency: a.request.currency },
        expiresAt: Date.now() + minutes * 60_000, because: a.description.effect,
      });
      services.graph.delegated.approve(actionId, grant.id);
      return { grantId: grant.id };
    },
    "actions:dispatch": ({ actionId }) => services.graph.delegated.dispatch(actionId, (plan) => {
      // The second, independent gate: the broker, over the same plan.
      services.broker.guard({ tool: "outreach.send", args: { ...plan.args, destination: plan.destination }, scope: plan.destination });
    }),
    "actions:checkStatus": ({ attemptId }) => services.graph.delegated.checkStatus(attemptId),
    "actions:list": ({ id }) => services.graph.delegated.list(id),
    "actions:get": ({ id }) => {
      const a = services.graph.delegated.get(id);
      const attempts = services.graph.delegated.attempts(id);
      return { ...a, attempts, checks: Object.fromEntries(attempts.map((x) => [x.id, services.graph.delegated.checksOf(x.id)])) };
    },
    "actions:discard": ({ actionId }) => {
      const a = services.graph.delegated.get(actionId);
      if (a.grantId) services.graph.grants.revoke(a.grantId, "you discarded this action");
      services.graph.db.prepare(`DELETE FROM delegated_actions WHERE id = ? AND state IN ('draft','approved')`).run(actionId);
    },
    "routes:list": () => services.routes.endpoints.map((e) => ({
      id: e.id, label: e.label, endpoint: e.endpoint, statusEndpoint: e.statusEndpoint, fields: e.fields,
      hasToken: services.routes.tokens.has(e.id),
    })),
    "routes:setToken": ({ routeId, token }) => { services.routes.tokens.write(routeId, token); return { hasToken: true }; },
    "routes:removeToken": ({ routeId }) => { services.routes.tokens.remove(routeId); return { hasToken: false }; },
    "plans:current": ({ id }) => services.graph.plans.current(id),
    "plans:propose": ({ id }) => services.graph.plans.propose(id),
    "plans:adoptAll": ({ id }) => services.graph.plans.adoptAll(id),
    "plans:setDisposition": ({ goalId, stepId, disposition }) => services.graph.plans.setDisposition(goalId, stepId, disposition),
    "plans:edit": ({ goalId, stepId, ...patch }) => services.graph.plans.edit(goalId, stepId, patch),
    "plans:reorder": ({ goalId, order }) => services.graph.plans.reorder(goalId, order),
    "plans:addStep": ({ goalId, ...input }) => services.graph.plans.addStep(goalId, input),
    "plans:replaceStep": ({ goalId, stepId, ...input }) => services.graph.plans.replaceStep(goalId, stepId, input),
    "plans:setInputs": ({ goalId, stepId, objectIds }) => services.graph.plans.setInputs(goalId, stepId, objectIds),
    "plans:setExecution": ({ goalId, stepId, execution, note }): { work: StepWork | null; refused: string | null } => {
      // Complete is refused in words when the rule does not hold; the screen shows the words.
      try { return { work: services.graph.plans.setExecution(goalId, stepId, execution, note !== undefined ? { note } : {}), refused: null }; }
      catch (cause) { if (cause instanceof NotComplete) return { work: services.graph.plans.workOf(goalId, stepId), refused: cause.message }; throw cause; }
    },
    "plans:attachEvidence": ({ goalId, stepId, evidence }) => services.graph.plans.attachEvidence(goalId, stepId, evidence),
    "plans:work": ({ id }) => services.graph.plans.work(id),
    "goals:standing": ({ id }) => standingFor(services.graph, id),
    "workState:assess": ({ id }) => new WorkStateStore(services.graph, (objectId) => services.readiness.evaluateAll(objectId)).assess(id),
    "workState:session": ({ id }) => new WorkStateStore(services.graph).session(id),
    "workState:start": ({ goalId, objectId, signalId,depth }) => new WorkStateStore(services.graph, (id) => services.readiness.evaluateAll(id)).start(goalId, objectId, signalId,depth),
    "workState:answer": (answer) => new WorkStateStore(services.graph, (id) => services.readiness.evaluateAll(id)).answer(answer),
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
    "process:exportPage": ({ id, eventIds, discloseHashes, discloseTiming, humanPass }) => {
      const state = services.graph.currentState(id);
      if (!state) throw new Error("This Object no longer exists.");
      const result = renderProofPage(services.graph.process.proof(id), { title: state.properties.title,
        eventIds, discloseHashes, discloseTiming, humanPass });
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
    "models:select": ({ modelId, selected }) => services.models.select(modelId, selected),
    "models:budget": () => services.models.budget(),
    "models:setBudget": ({ perActionUsdMax, monthlyUsdMax }) => services.models.setBudget(perActionUsdMax, monthlyUsdMax),
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

    "living:pickSource": async ({id}) => {
      const object=services.graph.getObject(id);if(!object)throw new Error("This project item is unavailable.");services.graph.assertWritable(id);
      const chosen=await dialog.showOpenDialog({title:"Add your source file",properties:["openFile"]});if(chosen.canceled||!chosen.filePaths[0])return null;
      const path=chosen.filePaths[0];const result=await services.router.execute({intent:"Import source file",objects:[id],tool:"import.file",args:{path},confirmation:false},{worldId:object.worldId,objectId:id,formRoles:["source.primary","model.mesh"],label:"Source added"});return result.state??null;
    },
    "living:saveForm": async ({id,role}) => {
      const state=services.graph.currentState(id),form=state?.forms.find(f=>f.role===role);const rep=form&&services.graph.getRepresentation(form.representationId);if(!rep?.blobHash)throw new Error("Create this result before saving it.");
      const extension=/^[a-z0-9]{1,12}$/i.test(rep.format)?rep.format:"bin";
      const chosen=await dialog.showSaveDialog({title:"Save result",defaultPath:`${(state!.properties.title).replace(/[^a-z0-9]+/gi,"-").slice(0,65)||"result"}-${role.split('.').at(-1)}.${extension}`});if(chosen.canceled||!chosen.filePath)return null;
      if(services.graph.currentState(id)?.versionId!==state!.versionId)throw new Error("This result changed. Preview it again before saving.");
      writeFileSync(chosen.filePath,services.graph.readBlob(rep.blobHash));return {path:chosen.filePath};
    },
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

    "sense:capture": ({ worldId, kind, title, text, url, author, sourceIdentity, permittedUse, aiProcessing,journeyVersionId }) => services.graph.db.transaction(()=>{
      if(journeyVersionId){if(aiProcessing==="never"||permittedUse==="restricted")throw new Error("Keep private material outside the AI work path.");const j=services.journey.get(worldId);if(!j||j.versionId!==journeyVersionId)throw new Error("The work path changed. Refresh before saving into it.");}
      // The copy is stored with where it came from and what may be done with it; candidates are
      // proposed, as such. Saving, proposing and accepting stay three separate acts.
      const source = services.sense.recordSource({
        worldId, kind, title, text, hash: sha256Hex(text), url: url ?? null, author: author ?? null,
        rights: permittedUse,
        metadata: {
          ...(sourceIdentity ? { capturedFrom: "visible_session", tabId: sourceIdentity.tabId, account: sourceIdentity.profileLabel, capturedAt: Date.now() } : {}),
          ...(aiProcessing === "never" ? { aiProcessing: "never" } : {}),
        },
      });
      // A Source is not an Object, so the permission lives with the Source itself and the
      // context compiler reads it there. Saying it must record it somewhere it will be read.
      const version = services.sense.latestVersionOf(source.id);
      const candidates = version ? services.sense.propose(worldId, version.id, extractCandidates(text), "heuristic/1") : [];
      if(journeyVersionId)services.journey.attachSource(worldId,journeyVersionId,source.id);
      return { sourceId: source.id, candidates };
    })(),

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
