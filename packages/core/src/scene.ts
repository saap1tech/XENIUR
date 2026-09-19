import { z } from "zod";
import { UuidSchema } from "./ids.js";
import { PermissionLevelSchema } from "./permissions.js";

/**
 * The closed registry. The Brain composes tested components by name; it never emits
 * frontend code for XENIUR's privileged interface. A Scene naming anything outside this
 * list is refused at validation and again at render.
 */
export const SCENE_COMPONENTS = [
  "Canvas", "ObjectCard", "Inspector", "Document", "Timeline", "TaskProgress",
  "Comparison", "Browser", "CodePreview", "Viewport3D", "ApprovalDialog", "Gallery",
  // Living Objects
  "FormStrip", "ReadinessBoard", "ChecksPanel", "RebuildPreview", "VersionTimeline",
  "ImportDrop", "LineageGraph", "RecipeGraph",
  // Sensemaking
  "ThinkingMap", "IngredientPanel", "FocusView",
  // The calm workspace
  "ImpactReview", "CausalPath", "DecisionCard", "SourceViewer", "PreviewCard",
  "InspectorQuestions", "CompareForms", "ThinkingTable", "IdeaDrawer",
  // Visual intent grammar
  "ObjectOrbit", "AffordanceRing", "SpatialCanvas", "ConstraintStrip", "RangeMeter",
  "PriorityBalance", "PeopleChips", "Calendar", "SchematicMap", "ChoiceCards", "Stepper",
  "EvidenceMeter", "EmptySlot", "ReviewSheet",
  // Inspectable work
  "ClaimPair", "TrustStrip",
  // Your models
  "ModelSetup",
  // What the model will see
  "ContextReview",
  // Bounded, visible, leavable contracts
  "FocusContract",
  // Challenges: signed rules, an AI policy, a three-state verdict
  "ChallengeBoard",
  // Lenses: a report as its claims; what the agent saw, decided, was allowed, did
  "SupportMap", "AgentTrail",
  // Where you stand: the persistent state of the work, as a representation
  "Standing",
  // A model's proposals before they are knowledge; the compact context indicator
  "ProposalsTray", "ContextIndicator",
  // Four moves beside a selected idea, each making something persistent
  "ThinkingMoves",
] as const;
export const SceneComponentSchema = z.enum(SCENE_COMPONENTS);
export type SceneComponentName = z.infer<typeof SceneComponentSchema>;

const base = { id: z.string().min(1) };

const ObjectCardNode = z.object({
  ...base, component: z.literal("ObjectCard"),
  objectId: UuidSchema,
  x: z.number().default(0), y: z.number().default(0),
  width: z.number().positive().default(220),
  selected: z.boolean().default(false),
}).strict();

const InspectorNode = z.object({
  ...base, component: z.literal("Inspector"),
  objectId: UuidSchema,
  showLineage: z.boolean().default(true),
  showProvenance: z.boolean().default(true),
}).strict();

const DocumentNode = z.object({
  ...base, component: z.literal("Document"),
  objectId: UuidSchema, editable: z.boolean().default(true),
}).strict();

const TimelineNode = z.object({
  ...base, component: z.literal("Timeline"),
  objectIds: z.array(UuidSchema),
  durationMs: z.number().nonnegative().default(0),
}).strict();

const TaskProgressNode = z.object({
  ...base, component: z.literal("TaskProgress"),
  taskIds: z.array(UuidSchema),
}).strict();

const ComparisonNode = z.object({
  ...base, component: z.literal("Comparison"),
  leftRepresentationId: UuidSchema,
  rightRepresentationId: UuidSchema,
  label: z.string().default(""),
}).strict();

const BrowserNode = z.object({
  ...base, component: z.literal("Browser"),
  url: z.string().url(),
  viewId: z.string().min(1),
}).strict();

const CodePreviewNode = z.object({
  ...base, component: z.literal("CodePreview"),
  objectId: UuidSchema,
  entry: z.string().default("index.html"),
  running: z.boolean().default(false),
}).strict();

const Viewport3DNode = z.object({
  ...base, component: z.literal("Viewport3D"),
  representationId: UuidSchema,
  background: z.string().default("#0b0d12"),
}).strict();

const ApprovalDialogNode = z.object({
  ...base, component: z.literal("ApprovalDialog"),
  taskId: UuidSchema,
  level: PermissionLevelSchema,
  /** The XENIUR-native preview line, e.g. "Book court · 5:00 PM · $18". */
  preview: z.string().min(1),
  detail: z.string().default(""),
}).strict();

const GalleryNode = z.object({
  ...base, component: z.literal("Gallery"),
  objectIds: z.array(UuidSchema),
  columns: z.number().int().min(1).max(8).default(3),
}).strict();

const FormStripNode = z.object({
  ...base, component: z.literal("FormStrip"),
  objectId: UuidSchema,
  selectedRole: z.string().nullable().default(null),
  /** Off by default: a form is a thing you made, not a file you have to manage. */
  showFileNames: z.boolean().default(false),
}).strict();

const ReadinessBoardNode = z.object({
  ...base, component: z.literal("ReadinessBoard"),
  objectId: UuidSchema,
  /** Action profiles are hidden by default; they gate doing, not delivering. */
  showAll: z.boolean().default(false),
}).strict();

const ChecksPanelNode = z.object({
  ...base, component: z.literal("ChecksPanel"),
  objectId: UuidSchema,
  formRole: z.string().nullable().default(null),
}).strict();

const RebuildPreviewNode = z.object({
  ...base, component: z.literal("RebuildPreview"),
  objectId: UuidSchema,
}).strict();

const VersionTimelineNode = z.object({
  ...base, component: z.literal("VersionTimeline"),
  objectId: UuidSchema,
}).strict();

const ImportDropNode = z.object({
  ...base, component: z.literal("ImportDrop"),
  objectId: UuidSchema.nullable().default(null),
  label: z.string().default("Drop a file here"),
}).strict();

const LineageGraphNode = z.object({
  ...base, component: z.literal("LineageGraph"),
  representationId: UuidSchema,
}).strict();

const RecipeGraphNode = z.object({
  ...base, component: z.literal("RecipeGraph"),
  objectId: UuidSchema,
}).strict();

const ThinkingMapNode = z.object({
  ...base, component: z.literal("ThinkingMap"),
  worldId: UuidSchema,
  limit: z.number().int().min(1).max(50).default(6),
}).strict();

const IngredientPanelNode = z.object({
  ...base, component: z.literal("IngredientPanel"),
  objectId: UuidSchema,
}).strict();

const FocusViewNode = z.object({
  ...base, component: z.literal("FocusView"),
  objectId: UuidSchema,
  minutes: z.number().int().min(0).max(240).default(0),
}).strict();

/**
 * What changed since the last delivery, split into rebuild and review.
 *
 * The split is the first thing a person sees on a selected Object rather than something
 * they have to be taught, which is why it is its own component and not a section of the
 * rebuild preview.
 */
const ImpactReviewNode = z.object({
  ...base, component: z.literal("ImpactReview"),
  objectId: UuidSchema,
  /** Compact: the headline and counts only, for the status line under a form strip. */
  compact: z.boolean().default(false),
}).strict();

/** One explanation, in plain language, generated from the edge that caused it. */
const CausalPathNode = z.object({
  ...base, component: z.literal("CausalPath"),
  objectId: UuidSchema,
  /** Which item to explain: a recipe step key, or a decision's object id. */
  subject: z.string().min(1),
  kind: z.enum(["rebuild", "review"]),
}).strict();

const DecisionCardNode = z.object({
  ...base, component: z.literal("DecisionCard"),
  objectId: UuidSchema,
  showEvidence: z.boolean().default(true),
}).strict();

/** A stored passage in its context, reached from a source chip on a decision card. */
const SourceViewerNode = z.object({
  ...base, component: z.literal("SourceViewer"),
  atomObjectId: UuidSchema,
}).strict();

/**
 * What is about to happen, before it happens.
 *
 * Rendered from the same authorisation digest that gates the action, so the preview and
 * the thing authorised cannot drift apart — they are the same object.
 */
const PreviewCardNode = z.object({
  ...base, component: z.literal("PreviewCard"),
  planDigest: z.string().min(1),
}).strict();

/** The five human questions, never database concepts. */
const InspectorQuestionsNode = z.object({
  ...base, component: z.literal("InspectorQuestions"),
  objectId: UuidSchema,
  /** Which question is open. All five are always listed. */
  open: z.enum(["what", "why", "changed", "ready", "next"]).default("what"),
}).strict();

/** Old and new side by side, for any two versions of a form. */
const CompareFormsNode = z.object({
  ...base, component: z.literal("CompareForms"),
  objectId: UuidSchema,
  formRole: z.string().min(1),
  leftVersionId: UuidSchema.nullable().default(null),
  rightVersionId: UuidSchema.nullable().default(null),
}).strict();

/** Sensemaking as a table you push things around on, not a list you scroll. */
const ThinkingTableNode = z.object({
  ...base, component: z.literal("ThinkingTable"),
  worldId: UuidSchema,
  selectedId: UuidSchema.nullable().default(null),
}).strict();

/** The ingredient drawer, shown at the moment of creation and nowhere else. */
const IdeaDrawerNode = z.object({
  ...base, component: z.literal("IdeaDrawer"),
  objectId: UuidSchema,
  open: z.boolean().default(false),
}).strict();

const TaskStateSchema = z.enum(["selected", "missing", "changed", "ready", "blocked", "conflict"]);
const DisclosureLayerSchema = z.number().int().min(1).max(4);

const ObjectOrbitNode = z.object({
  ...base, component: z.literal("ObjectOrbit"), focusId: UuidSchema,
  relatedIds: z.array(UuidSchema).default([]),
  state: TaskStateSchema.default("selected"), disclosure: DisclosureLayerSchema.default(2),
}).strict();

const AffordanceRingNode = z.object({
  ...base, component: z.literal("AffordanceRing"), objectId: UuidSchema,
  proposalIds: z.array(z.string().min(1)).default([]),
}).strict();

const SpatialEdgeSchema = z.object({
  id: z.string().min(1), from: UuidSchema, to: UuidSchema,
  relation: z.string().min(1), state: TaskStateSchema.optional(),
}).strict();

const SpatialCanvasNode = z.object({
  ...base, component: z.literal("SpatialCanvas"), focusId: UuidSchema,
  objectIds: z.array(UuidSchema).default([]), edges: z.array(SpatialEdgeSchema).default([]),
  disclosure: DisclosureLayerSchema.default(2),
}).strict();

const ConstraintStripNode = z.object({
  ...base, component: z.literal("ConstraintStrip"),
  constraintIds: z.array(UuidSchema).default([]), disclosure: DisclosureLayerSchema.default(2),
}).strict();

const ConstraintControlNode = <T extends string>(component: T) => z.object({
  ...base, component: z.literal(component), constraintId: UuidSchema,
}).strict();

const RangeMeterNode = ConstraintControlNode("RangeMeter");
const PriorityBalanceNode = ConstraintControlNode("PriorityBalance");
const PeopleChipsNode = ConstraintControlNode("PeopleChips");
const CalendarNode = ConstraintControlNode("Calendar");
const StepperNode = ConstraintControlNode("Stepper");

const SchematicMapNode = z.object({
  ...base, component: z.literal("SchematicMap"), constraintId: UuidSchema.nullable().default(null),
  placeIds: z.array(z.string().min(1)).default([]), selectedPlaceId: z.string().nullable().default(null),
}).strict();

const ChoiceSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), detail: z.string().default(""),
  selected: z.boolean().default(false), excluded: z.boolean().default(false),
  cost: z.number().nonnegative().nullable().default(null),
}).strict();

const ChoiceCardsNode = z.object({
  ...base, component: z.literal("ChoiceCards"), choices: z.array(ChoiceSchema).default([]),
  meaning: z.string().min(1).default("choice"),
}).strict();

const EvidenceMeterNode = z.object({
  ...base, component: z.literal("EvidenceMeter"), objectId: UuidSchema,
  disclosure: DisclosureLayerSchema.default(3),
}).strict();

const EmptySlotNode = z.object({
  ...base, component: z.literal("EmptySlot"), meaning: z.string().min(1),
  label: z.string().min(1),
}).strict();

const ReviewSheetNode = z.object({
  ...base, component: z.literal("ReviewSheet"), objectId: UuidSchema,
  title: z.string().min(1), sections: z.array(z.string().min(1)).default([]),
}).strict();

/**
 * Two claims and the relation a person asserted between them, with the passage behind the
 * second. The contradiction view — "your claim ↕ their claim" — and the shape a critique takes.
 */
const ClaimPairNode = z.object({
  ...base, component: z.literal("ClaimPair"),
  leftObjectId: UuidSchema,
  rightObjectId: UuidSchema,
  relation: z.enum(["supports", "contradicts", "informed_by", "same_as", "derived_from"]),
}).strict();

/**
 * "Can I trust this work?" — five cells of facts, never a tick. Lime only when settled.
 */
const TrustStripNode = z.object({
  ...base, component: z.literal("TrustStrip"),
  objectId: UuidSchema,
  /** Compact for a folder card; full for a focused Object or a delivery. */
  compact: z.boolean().default(false),
}).strict();

/**
 * Your models: the providers as cards, what a key unlocks in the three economy tiers, and
 * Skip as a first-class exit. The key itself is typed into a field the renderer sends once
 * and never sees again.
 */
const ModelSetupNode = z.object({
  ...base, component: z.literal("ModelSetup"),
  /** Whether this is the first-run scene (Skip for now) or Settings (no skip needed). */
  firstRun: z.boolean().default(false),
}).strict();

/**
 * "What the model will see" — the included items as chips, and what was left out and why,
 * beside the cost. One confirmation covers content and cost, because they are one plan.
 */
const ContextReviewNode = z.object({
  ...base, component: z.literal("ContextReview"),
  /** The compiled context's digest — the key the plan is filed under. */
  contextDigest: z.string().min(1),
}).strict();

/**
 * A mode in one of its two visible phases. In review, the sheet is looked up by its digest —
 * the same digest `start` requires, so a person cannot begin from an envelope they did not
 * read. Running, it is the thin rule at the top of the window with an Exit.
 */
const FocusContractNode = z.object({
  ...base, component: z.literal("FocusContract"),
  phase: z.enum(["review", "running"]),
  /** Review: the sheet the person is reading. */
  sheetDigest: z.string().min(1).nullable().default(null),
  /** Running: the mode whose rule is shown. */
  modeId: UuidSchema.nullable().default(null),
}).strict();

/** A challenge World's centre: rules, dates, deliverable, judging, policy, and the entries. */
const ChallengeBoardNode = z.object({
  ...base, component: z.literal("ChallengeBoard"), worldId: UuidSchema,
}).strict();

/** A report as its claims, in lanes by support state. Never a percentage. */
const SupportMapNode = z.object({
  ...base, component: z.literal("SupportMap"), objectId: UuidSchema,
  /** Which lanes to show; empty means all five. A lens picks a subset. */
  lanes: z.array(z.enum(["supported", "ambiguous", "unresolved", "contradicted", "own"])).default([]),
  disclosure: DisclosureLayerSchema.default(2),
}).strict();

/** Saw · decided · authorised · executed. A short row stays short. */
const AgentTrailNode = z.object({
  ...base, component: z.literal("AgentTrail"), objectId: UuidSchema,
}).strict();

/** Where you stand on a goal: five knowledge states, what changed, what is next, what is needed. */
const StandingNode = z.object({ ...base, component: z.literal("Standing"), goalId: UuidSchema }).strict();

/** Candidates awaiting review, per World. Nothing here is an atom. */
const ProposalsTrayNode = z.object({ ...base, component: z.literal("ProposalsTray"), worldId: UuidSchema }).strict();
/** An ordinary request's context, in one line: scope, exclusions, destination. */
const ContextIndicatorNode = z.object({ ...base, component: z.literal("ContextIndicator"), contextDigest: z.string().min(1) }).strict();

/** Find the basis · Challenge it · Connect it · Test it, beside a claim, question or decision. */
const ThinkingMovesNode = z.object({ ...base, component: z.literal("ThinkingMoves"), objectId: UuidSchema }).strict();

const LeafNodeSchema = z.discriminatedUnion("component", [
  ObjectCardNode, InspectorNode, DocumentNode, TimelineNode, TaskProgressNode,
  ComparisonNode, BrowserNode, CodePreviewNode, Viewport3DNode, ApprovalDialogNode,
  GalleryNode,
  FormStripNode, ReadinessBoardNode, ChecksPanelNode, RebuildPreviewNode,
  VersionTimelineNode, ImportDropNode, LineageGraphNode, RecipeGraphNode,
  ThinkingMapNode, IngredientPanelNode, FocusViewNode,
  ImpactReviewNode, CausalPathNode, DecisionCardNode, SourceViewerNode, PreviewCardNode,
  InspectorQuestionsNode, CompareFormsNode, ThinkingTableNode, IdeaDrawerNode,
  ObjectOrbitNode, AffordanceRingNode, SpatialCanvasNode, ConstraintStripNode,
  RangeMeterNode, PriorityBalanceNode, PeopleChipsNode, CalendarNode, SchematicMapNode,
  ChoiceCardsNode, StepperNode, EvidenceMeterNode, EmptySlotNode, ReviewSheetNode,
  ClaimPairNode, TrustStripNode, ModelSetupNode, ContextReviewNode,
  FocusContractNode, ChallengeBoardNode, SupportMapNode, AgentTrailNode, StandingNode,
  ProposalsTrayNode, ContextIndicatorNode, ThinkingMovesNode,
]);
export type LeafSceneNode = z.infer<typeof LeafNodeSchema>;

export interface CanvasSceneNode {
  id: string;
  component: "Canvas";
  layout: "free" | "grid" | "row" | "column";
  children: SceneNode[];
}
export type SceneNode = LeafSceneNode | CanvasSceneNode;

// The third type parameter is the *input* type: `.default()` makes fields optional on
// the way in, so annotating the input as the output type would reject valid Scene JSON.
const CanvasNodeSchema: z.ZodType<CanvasSceneNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    component: z.literal("Canvas"),
    layout: z.enum(["free", "grid", "row", "column"]).default("free"),
    children: z.array(SceneNodeSchema).default([]),
  }).strict(),
);

export const SceneNodeSchema: z.ZodType<SceneNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([LeafNodeSchema, CanvasNodeSchema]),
);

/** The whole declarative interface for what the person is doing right now. */
export const SceneSchema = z.object({
  worldId: UuidSchema,
  title: z.string().default(""),
  /** Smallest appropriate interface: the Brain justifies why this shape, in one line. */
  reason: z.string().default(""),
  /** Stable structural identity emitted by the layout compiler. */
  layoutId: z.string().min(1).optional(),
  /** A compiled scene always names the durable subject in its centre slot. */
  focusId: UuidSchema.nullable().optional(),
  disclosure: DisclosureLayerSchema.optional(),
  slots: z.array(z.object({
    id: z.string().min(1), nodeId: z.string().min(1), role: z.enum(["centre", "primary", "supporting"]),
  }).strict()).optional(),
  root: SceneNodeSchema,
});
export type Scene = z.infer<typeof SceneSchema>;

export const isKnownComponent = (name: string): name is SceneComponentName =>
  (SCENE_COMPONENTS as readonly string[]).includes(name);
