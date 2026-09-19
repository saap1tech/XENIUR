# XENIUR M4 architecture

> **Status:** implemented architecture and product specification  
> **Product thesis:** XENIUR is the visual interface between humans and digital capability, especially in the era of AI.  
> **Primary proof:** `npm run demo:visual`  
> **Scope:** semantic and layout compilers, explicit goal/scope boundaries, trait composition, direct manipulation, typed constraints, process provenance, Action Receipt Objects, declarative capabilities, the Electron application, the protected web layer, compute economics, trusted workflows, and the complete frontend language.

This document is the authoritative explanation of how XENIUR turns a person's intent and a durable graph of work into a stable visual interface. It describes the current implementation rather than a speculative replacement for it. Product ideas that remain intentionally deferred are called out as such.

---

## 1. Product model

XENIUR is not a chat window with tools attached and it is not a conventional application launcher. It keeps the meaningful parts of work—sources, claims, decisions, constraints, Living Objects, versions, forms, recipes, checks, and deliveries—in a durable graph. It then compiles the current situation into the smallest visual surface that lets a person understand or change it.

The user should normally manipulate the meaning of the problem:

- move a Claim beside an Object to propose a relationship;
- change a budget constraint and watch excluded choices leave;
- compare two forms without locating their files;
- see why a Decision needs review without reading the graph;
- see cost and provenance consequences before expensive generation;
- publish a deliberately filtered account of how an Object came into existence.

Language remains a peer interaction. Command-K and the intent field are valuable when words are faster. XENIUR measures when a visual path or language was used, but does not treat typing as failure.

### Core nouns

| Noun | Meaning |
|---|---|
| **World** | A project boundary containing related work. |
| **Living Object** | A durable semantic thing with versions, properties, forms, provenance, recipe state, checks, and history. |
| **Form** | A representation of an Object: source, preview, thumbnail, mesh, print, document, delivery, and so on. |
| **Decision** | A recorded human choice with alternatives, evidence, and downstream influence. |
| **Constraint Object** | A typed, versioned rule attached to what it constrains. |
| **Situation** | A validated compiler input describing the goal, inspectable scope, meaning, interaction, state, focus, Objects, changes, constraints, choices, and disclosure layer. |
| **Semantic Plan** | The pure compiler's answer to “what belongs here?” |
| **Scene** | Closed declarative JSON describing which trusted components render and where. |
| **Action Plan** | A proposed effect, including its permission level and digest. |
| **Process Event** | A factual record of how work happened. |
| **Action Receipt Object** | A durable Living Object that records a consequential external attempt, the authorised plan, destination, disclosed data digests, price, response, time, and outcome. |
| **Capability Manifest** | A strict XCDL data program declaring semantic inputs, permission, visual semantics, trusted execution, and output traits without supplying UI or executable code. |

### Non-goals

- The renderer never executes generated React, HTML, CSS, or arbitrary plugin code.
- A drag never directly performs an effect.
- Similarity never proves theft, ownership, or infringement.
- “No listed threat detected” never becomes a promise that a website is safe.
- Intelligence and costly generation do not share a deliberately confusing credit meter.
- The first workflow exchange is data-only; it is not an arbitrary executable plugin marketplace.
- Recorded app activity is never presented as total human effort, and “user-created” is never silently upgraded to “original.”
- M4 travel uses fixtures. It does not add maps, bookings, payments, accounts, or network geography.

---

## 2. System at a glance

```text
Sources + ObjectGraph + constraints + impact + process history
                              │
                              ▼
                         Situation
                              │
                    compileSituation()
                    pure meaning policy
                              │
                              ▼
                         SemanticPlan
                    concepts + affordances
                              │
                         layoutScene()
                    pure geometry policy
                              │
                              ▼
                           Scene JSON
                              │
                 Zod schema → closed registry
                              │
                              ▼
                    React SceneRenderer
                              │
                       SceneBindings
                 data and callbacks from host
```

The architecture separates contract, policy, storage, presentation, and authority:

| Layer | Package or process | Responsibility | Must not do |
|---|---|---|---|
| Contract | `@xeniur/core` | Stable schemas, shared types, bridge contracts, Scene vocabulary, action and permission contracts | Import mutable product policy |
| Visual policy | `@xeniur/grammar` | Resolve meaning/state/interaction plus traits, enforce goal/scope, compile concepts, assign stable layout | Perform I/O, fetch data, call Electron, or execute actions |
| Capability language | `@xeniur/capabilities` | Validate and register XCDL manifests, check subject traits, bind visual aliases, produce bounded Action Plans | Execute manifest code, accept custom React/CSS/selectors, or bypass trusted adapters |
| Durable graph | `@xeniur/graph` | SQLite storage, migrations, versions, links, impact, constraints, metrics, process, workflows, compute ledger | Render UI |
| Visual primitives | `@xeniur/ui` | Closed registry, Scene validation, React components, semantic twin | Fetch, invent authority, or accept unknown components |
| Reasoning | `@xeniur/brain` | Turn language and context into bounded intent/plans | Bypass schemas, broker, or capability router |
| Capability routing | `@xeniur/router` | Choose trusted local/provider tools and route rebuilds | Queue metered generation without a quote |
| Authority | `@xeniur/permissions` | Preview and guard consequential plans using `planDigest` | Trust a UI label or page instruction as authorisation |
| Execution | `@xeniur/tasks`, `@xeniur/hands`, providers | Queue, run, observe, and settle work | Let untrusted page content approve work |
| Desktop host | Electron main/preload | Own privileged services, validate IPC, isolate web content, expose narrow bridge | Expose raw Electron APIs to the renderer |
| Desktop renderer | React | Hold navigation state, request data, compile current situations, render scenes and review surfaces | Access Node.js or privileged Electron APIs directly |

Dependency direction is one-way around the kernel:

```text
core ← grammar / capabilities
core ← graph
core ← ui
core ← brain / router / permissions / tasks / hands
        ↑
Electron main composes services
        ↑ narrow typed preload bridge
Electron renderer composes situations and scenes
```

`@xeniur/grammar` is separate from `@xeniur/core` deliberately. Core is the contract imported everywhere and therefore expensive to change. Grammar is product policy and must remain editable.

---

## 3. Repository map

```text
apps/desktop/
  src/main/                 privileged Electron host
    index.ts                BrowserWindow creation and lifecycle
    ipc.ts                  validated IPC registration
    services.ts             graph, router, queues, broker and service composition
    economy.ts              quote/confirm bridge orchestration
    browser.ts              isolated live-site WebContentsView lifecycle
    web/
      policy.ts             local URL and destination policy
      risk.ts               reputation check and cache
      capture.ts            Explore fetch and inert extraction
      proxy.ts              validating local CONNECT proxy
  src/preload/index.ts      explicit contextBridge surface
  src/renderer/
    App.tsx                 application state machine and global overlays
    Home.tsx                entry surface and economic model
    World.tsx               three-zone visual workbench
    ObjectView.tsx          Living Object surface
    FocusMode.tsx           quiet single-object mode
    WebLayer.tsx            Explore / Live Site / Act
    WorkflowLibrary.tsx     trusted data-only workflow exchange
    ComputeReview.tsx       pre-execution compute disclosure
    ProcessShare.tsx        privacy-filtered proof export
    CommandPalette.tsx      keyboard peer to visual actions
    BrandMark.tsx           supplied XR SVG identity
    components/ui/          shadcn-compatible reusable UI components
    styles.css              product design system and application layout
    tailwind.css            Tailwind entry point

packages/
  core/                     schemas and contracts
  grammar/                  semantic and layout compilers
  capabilities/             XCDL registry and trusted manifest compiler
  graph/                    durable data and migrations
  ui/                       Scene registry and visual primitives
  brain/                    bounded intent interpretation
  router/                   capability routing
  permissions/              authorisation broker
  tasks/                    task queue
  hands/                    controlled browser/action execution
  providers/                configured capability providers
  sensemaking/              extraction and thinking-map policy
  validators/               media/Object validation
  sessions/                 execution/session boundaries

brand/
  XR_logo_vector.svg        canonical product mark

scripts/
  demo-visual.tsx           flagship semantic + rendered proof
  preview-ui.tsx            registry surface gallery
  demo-revision.ts          rebuild/review regression proof
  demo-asset.ts             asset flow proof
  demo-sense.ts             sensemaking proof
  e2e-loop.ts               full application loop
```

---

## 4. The three-dimensional visual grammar

A single list of “concepts” cannot distinguish what a situation is about, how the work stands, and what the person is doing. XENIUR uses three closed dimensions.

### 4.1 Meaning: the noun

`where` · `when` · `who` · `cost` · `quantity` · `priority` · `sequence` · `relationship`

Meaning selects the base visual metaphor.

### 4.2 Task state: the adjective

`selected` · `missing` · `changed` · `ready` · `blocked` · `conflict`

State usually modifies a primitive. It does not create a parallel component taxonomy. “Blocked” dims and marks an existing thing; “changed” gives it review or rebuild treatment.

| State | Visual modifier |
|---|---|
| selected | Full opacity and explicit selected treatment |
| missing | Reduced opacity and a `missing` marker |
| changed | Change marker and optional pulse; causal kind supplies review/rebuild colour |
| ready | Normal, settled presentation |
| blocked | Strongly reduced opacity and blocked treatment |
| conflict | Conflict marker or marked spatial edge |

Motion attached to a state respects `prefers-reduced-motion`.

### 4.3 Interaction: the verb

`choose` · `compare` · `adjust` · `connect` · `review` · `commit`

Interaction adds affordances or refines the primitive.

### 4.4 Closed resolution policy

The current resolver is total over every allowed meaning/interaction pair. General interaction rules are applied first and then refined by meaning:

| Condition | Components selected |
|---|---|
| any + compare | `CompareForms` |
| any + commit | `ReviewSheet` |
| any + connect | `SpatialCanvas`, with `AffordanceRing` when proposals exist |
| any + choose | `ChoiceCards` |
| any + review | `EvidenceMeter` |
| where + choose | `SchematicMap` + `ChoiceCards` |
| where + other supported interaction | `SpatialCanvas` |
| when + adjust | `Calendar` |
| when + connect | `Timeline` |
| who + adjust | `PeopleChips` |
| cost + adjust | `RangeMeter` |
| quantity + adjust | `Stepper` |
| priority + adjust | `PriorityBalance` |
| sequence + connect | `Timeline` |
| relationship except compare/commit | `ObjectOrbit` |

State enrichments are independent:

- `ready` adds `EvidenceMeter`;
- `missing` adds `EmptySlot`;
- `changed` with known causes adds `CausalPath`;
- constraints add `ConstraintStrip`;
- disclosure layer 4 may add `RecipeGraph` for an Object;
- available gesture proposals add `AffordanceRing`.

Tests fail if a dimension value lacks a definition or an allowed combination does not resolve.

### 4.5 Semantic traits: composition before domain switches

The three dimensions describe the current human situation. Traits describe durable capabilities of an Object. They are deliberately separate: a Hotel does not permanently mean “cost,” but its `priced` trait lets cost become available when the current goal and interaction need it.

The closed trait vocabulary is:

| Trait | Human concepts it can contribute |
|---|---|
| `locatable` | where |
| `temporal` | when |
| `priced` | cost |
| `personLike` | who |
| `versioned` | sequence |
| `composable` | relationship |
| `deliverable` | relationship and commit-oriented review |
| `printable` | relationship and print affordance eligibility |
| `bookable` | where, when, who, and cost |
| `spatial` | relationship and spatial manipulation |
| `renderable` | relationship and representation affordances |
| `external` | relationship plus authority boundary metadata |
| `consequential` | relationship plus review/receipt requirements |

Traits live in versioned `ObjectProperties`, so changing an Object's semantic capability is inspectable and undoable. `SemanticTraitsSchema` deduplicates and canonicalises trait order. The compiler resolves explicit meaning first, derives additional meanings from the focused Object's traits, maps them through the same closed primitive table, and removes duplicate components while preserving first occurrence. Traits therefore compose existing visual language; they do not grant permission, invent components, or identify a provider.

Examples:

```text
Hotel  = locatable + priced + temporal + bookable
       → map + calendar + people + cost/review primitives when relevant

Rocket = spatial + printable + renderable + versioned
       → orbit + spatial relationships + sequence and delivery affordances
```

This is the scaling rule for general visual computing. New domains should normally declare existing traits. A new trait earns its place only when it describes a reusable semantic capability across domains; a new Scene component still requires the registry process in the extension rules.

---

## 5. Situation: the compiler input

`Situation` is validated before compilation. It contains:

```ts
interface Situation {
  worldId: string;
  title: string;
  goal: {
    kind: "understand" | "decide" | "create" | "transform" | "validate" | "deliver" | "act";
    description?: string;
    deliverableId?: string;
  };
  scope: {
    worldId: string;
    objectIds?: string[];
    taskId?: string;
    externalContextAllowed: boolean;
  };
  meaning: Meaning;
  interaction: Interaction;
  taskStates: TaskState[];
  focus: {
    kind: "object" | "decision" | "constraints";
    id: string;
    label: string;
  };
  objects: SituationObject[];
  changes: SituationChange[];
  capabilities: string[];
  constraints: ConstraintRecord[];
  choices: SituationChoice[];
  layer: 1 | 2 | 3 | 4;
}
```

Three fields answer three different orientation questions:

| Field | Question | Stability purpose |
|---|---|---|
| `focus` | What am I touching? | Keeps the centre of the interface physically and semantically anchored. |
| `goal` | Why am I touching it? | Prevents identical data from producing an ambiguous “do everything” surface. |
| `scope` | What may influence this compile? | Prevents unrelated, private, stale, or external context from silently changing the interface. |

`goal.kind` is closed and required. `description` is optional human context, and `deliverableId` connects the desired outcome to a Living Object when one already exists. It is not an instruction string and it never authorises an action.

`scope.worldId` must equal `Situation.worldId`. When `scope.objectIds` is present, only those Objects, their admitted changes, and explicitly admitted Constraint Objects participate. The focus must be included. A `deliverableId` must name an Object already present in the Situation. External-prefixed capabilities are ignored unless `externalContextAllowed` is true. The schema and compiler both fail closed: context omitted from scope cannot affect component choice, choice filtering, causes, or affordances.

`scope.taskId` optionally attributes the compile to one durable task boundary. It does not cause the pure compiler to load task data; the host must still place every allowed fact into the Situation explicitly. The field is therefore an audit/context key, not a hidden query handle.

The renderer currently constructs scope from the loaded World snapshot and sets `externalContextAllowed: false` for normal World, Object, and Focus scenes. Protected Web and future explicit external flows must opt in at their own boundary; opening a World never grants that access implicitly.

The schema also verifies that an Object or Decision focus exists among the Situation Objects, and that a constraint focus exists among its constraints. This makes orientation a structural rule rather than a renderer convention.

### 5.1 Focus invariant

Every compiled Scene is anchored on the required focus. The focus is placed in the centre slot and the centre slot never empties. Focus changes only through an explicit user action such as choosing a World item, selecting an Object card, or entering a Decision zone.

Focus component selection is deterministic:

- a `focus:<minutes>` capability selects `FocusView`;
- a Decision focus selects `DecisionCard`;
- a constraint-set focus selects `ConstraintStrip`;
- a normal Object focus selects `ObjectOrbit`.

The shell repeats the focus label in `FocusBar` with an accessible live region. The centre and the label therefore cannot silently describe different targets.

### 5.2 Scope behavior and non-interference

Compilation first derives an in-memory scoped view. It does not mutate the caller's Situation. Filtering happens before primitive props, gesture targets, constraints, or causal paths are produced. This gives XENIUR a testable non-interference property:

> Adding an out-of-scope Object or external capability must not alter the compiled concept set, component props, affordances, or layout identity.

Scope is not a database security policy by itself. Storage access, IPC validation, protected-web policy, and permission checks still enforce their own boundaries. Scope is the semantic compiler's least-context contract: even data the host is technically allowed to read does not automatically become relevant UI context.

---

## 6. The two compilers

### 6.1 Semantic compiler

```ts
compileSituation(situation: Situation): SemanticPlan
```

The semantic compiler answers only “what belongs here?” Its output includes:

- `worldId`, title, `focusId`, and `focusLabel`;
- the validated `goal` and `scope` used for the compile;
- a stable `layoutId` derived from goal kind, meaning, interaction, and focus kind;
- the progressive disclosure layer;
- a concept set with trusted component types and semantic subjects;
- gesture affordances already resolved from the closed tables.

It never emits positions, coordinates, CSS, slots, or component implementation details. It reads no clock, random source, global cache, filesystem, database, browser, or network.

The semantic sequence is fixed:

1. filter Objects, changes, constraints, and external capabilities through scope;
2. resolve the focused Object and its traits;
3. choose the deterministic focus component;
4. combine explicit meaning primitives with trait-derived primitives;
5. resolve gesture proposals against scoped targets;
6. add state/disclosure concepts such as evidence, missing slots, causal paths, constraints, and machinery;
7. emit a layout-free `SemanticPlan`.

### 6.2 Layout compiler

```ts
layoutScene(plan: SemanticPlan, identity: LayoutIdentity): Scene
```

The layout compiler answers only “where does each selected concept go?” It verifies that:

1. the focal concept exists;
2. its subject matches `focusId`;
3. it occupies `centre`;
4. prior slot order for the same layout identity is preserved;
5. new concepts fill existing compatible positions or append; they do not reshuffle work under the user.

The resulting root is a `Canvas` using the free layout. Remaining concepts receive stable `slot-1`, `slot-2`, and subsequent assignments. The layout compiler does not reinterpret a concept's meaning.

### 6.3 Stability contract

The useful guarantee is **semantic stability**, not blanket byte equality.

For semantically equivalent Situations, XENIUR preserves:

- the concept set;
- component types;
- `layoutId`;
- focus identity;
- slot assignment and order.

Labels, values, counts, and other content may change without violating structural stability. Canonical byte serialisation is asserted only for fixtures and exported proof artifacts where byte equality is meaningful.

---

## 7. Progressive disclosure

The disclosure layer is part of the Scene contract rather than an assortment of component flags.

| Layer | User question | Content |
|---|---|---|
| 1 · outcome | “What is the thing?” | The focused Object, Decision, constraint set, or outcome |
| 2 · manipulate | “What can I change now?” | The few controls and affordances that matter |
| 3 · explain | “Why is it like this?” | Evidence, impact, causes, checks, and comparison |
| 4 · machinery | “How exactly was it made?” | Graph, recipe, provider, file, model, cost, and lineage |

The default application keeps machinery out of the centre until requested. Recipe and lineage views remain evidence behind “Show how this happened,” not the first interface a person must understand.

---

## 8. Scene contract and rendering boundary

Scene JSON is a discriminated union of strict Zod schemas. Unknown fields and unknown component names are rejected. The component name can only be one of the 46 entries in `SCENE_COMPONENTS`.

The render sequence is:

```text
unknown input
    │
    ├─ SceneSchema.safeParse() at IPC boundary
    │
    ├─ SceneSchema.safeParse() again in @xeniur/ui
    │
    ├─ planScene() walks the tree without React
    │      ├─ known + implemented → renderable
    │      └─ unknown/unimplemented → explicit refusal
    │
    └─ SceneRenderer renders only COMPONENT_REGISTRY entries
```

`planScene()` remains pure so the security/refusal rule can be tested without mounting React. `Canvas` is the sole container; every other registry entry is a leaf with a typed node schema.

### 8.1 SceneBindings

Components receive resolved data and callbacks through `SceneBindings`. They never fetch. Bindings may contain:

- Object states and current representations;
- task state and approval callbacks;
- recipe step state, rebuild plans, checks, readiness, versions, and lineage;
- thinking maps, friction items, ingredients, passages, Decisions, and impact reports;
- typed constraints and process proof summaries;
- pending plans keyed by the same `planDigest` used by the broker;
- gesture proposals;
- blob URL and text resolvers;
- callbacks for selecting, sorting, rebuilding, validating, releasing, reviewing, running, stopping, changing constraints, and choosing gesture proposals.

This division keeps data authority in the host. A component can render a callback it was given; it cannot discover or invoke a privileged capability by itself.

Form resolution follows the Object's head version and preferred semantic role. It never chooses “the latest representation row” merely because it was created most recently.

### 8.2 Semantic accessibility twin

`SceneRenderer` emits a semantic twin for assistive technology. It describes concepts, labels, values, state, and available acts—not component implementation names, pixel coordinates, or decorative geometry. A screen reader hears “Cost, maximum €1,500” rather than “RangeMeter.”

---

## 9. Complete Scene component inventory

The registry grows through reusable concepts, not situation-specific screens. A new workflow should first map to these primitives before it earns another component.

### 9.1 Foundation and work components

| Component | Purpose and frontend behavior |
|---|---|
| `Canvas` | The only Scene container. Supports free, grid, row, and column layout and recursively owns children. |
| `ObjectCard` | Selectable Object summary with optional free-layout coordinates, width, and selected state. Acts as a drag source/target where bindings permit. |
| `Inspector` | Detailed Object inspection with optional lineage and provenance sections. |
| `Document` | Document form surface with controlled editability. |
| `Timeline` | Temporal or sequential arrangement of Object IDs over a declared duration. |
| `TaskProgress` | Displays the state of one or more queued tasks without inventing task state locally. |
| `Comparison` | Displays two explicit representation IDs side by side with a human label. |
| `Browser` | Scene placeholder for an isolated browser view ID. It does not embed privileged browsing into React. |
| `CodePreview` | Object-bound preview of a declared entry file with run/stop state. |
| `Viewport3D` | Trusted 3D representation viewer with a controlled background. |
| `ApprovalDialog` | Permission-level review surface showing the plan preview and detail before approve/reject. |
| `Gallery` | Bounded multi-column collection of Objects. |

### 9.2 Living Object components

| Component | Purpose and frontend behavior |
|---|---|
| `FormStrip` | Displays the current Object forms by role and allows role selection. File names remain hidden by default because the semantic form matters more than storage trivia. |
| `ReadinessBoard` | Shows evidence by delivery profile. Action-only profiles are hidden unless deliberately expanded. |
| `ChecksPanel` | Lists validation results for the Object or selected form role. |
| `RebuildPreview` | Shows what will be recomputed and whether generation is involved before rebuild. |
| `VersionTimeline` | Traverses the Object's version and branch history with undo, redo, and branch switching callbacks. |
| `ImportDrop` | Empty or Object-bound drop surface for bringing a file into a World. |
| `LineageGraph` | Shows representation lineage only at the machinery/explanation layer. |
| `RecipeGraph` | Shows the Object's recipe DAG and step states at disclosure layer 4. |

### 9.3 Sensemaking and calm-workspace components

| Component | Purpose and frontend behavior |
|---|---|
| `ThinkingMap` | Compact World-level map of extracted knowledge, deliberately bounded by a limit. |
| `IngredientPanel` | Shows reusable source ingredients connected to an Object. |
| `FocusView` | Single-object representation used by Focus Mode, including an explicit exit. |
| `ImpactReview` | Splits consequences into mechanical **Rebuild** and semantic **Review**. Compact mode is available for status contexts. |
| `CausalPath` | Explains one rebuild or review cause in plain language from recorded graph edges. |
| `DecisionCard` | Shows a Decision, its accepted option, alternatives, and optionally its evidence. |
| `SourceViewer` | Opens a stored passage in context from a Decision's evidence without navigating to arbitrary site UI. |
| `PreviewCard` | Renders the proposed effect associated with a `planDigest`, keeping the visible preview bound to authorisation. |
| `InspectorQuestions` | The stable right-hand inspector: **What is it? Why this? What changed? Is it ready? What next?** One answer is open, all five questions remain visible. |
| `CompareForms` | Compares two versions of one form role; explicit versions can be supplied or sensible current history can be resolved from bindings. |
| `ThinkingTable` | Spatial, sortable thinking surface for Sources, Claims, Decisions, and Questions. |
| `IdeaDrawer` | Creation-time drawer for source ingredients; it is not permanent dashboard chrome. |

### 9.4 Visual-intent grammar components

| Component | Purpose and frontend behavior |
|---|---|
| `ObjectOrbit` | Keeps the focus at the centre while related Objects/forms orbit it. Rebuild/review state is carried by orbit items, not by a separate graph-reading mode. |
| `AffordanceRing` | Places inert, named gesture proposals around the target. Choosing an item begins brokered planning; it does not execute directly. |
| `SpatialCanvas` | Designed relationship field for positioned semantic nodes and marked edges. Supports drag-to-propose and keyboard-equivalent connection. |
| `ConstraintStrip` | Compact, always-readable row of typed constraints and values attached to the current problem. |
| `RangeMeter` | Accessible bounded adjustment for range constraints with unit, min/max, step, and current value. |
| `PriorityBalance` | Makes trade-offs between named priority dimensions manipulable without hiding the competing values. |
| `PeopleChips` | Direct people/party-size control for `who` situations. |
| `Calendar` | Date and date-range manipulation for `when` situations. |
| `SchematicMap` | Network-free designed diagram using fixture coordinates for districts, places, and distances. No tiles, tracking, or geography API. |
| `ChoiceCards` | A small, explicit set of alternatives with details and selected state. |
| `Stepper` | Keyboard-operable integral quantity control with bounds and unit. |
| `EvidenceMeter` | Communicates readiness/evidence strength while preserving the underlying facts and checks. |
| `EmptySlot` | Names required missing content and the action that can fill it. |
| `ReviewSheet` | Final pre-commit summary of outcome, data, site/provider, risk/cost, and confirmation controls. |

---

## 10. Direct manipulation and keyboard parity

Direct manipulation is a proposal system, not a hidden execution channel.

```text
pointer drag or keyboard “connect”
             │
             ▼
proposalsFor(source, target)
             │ pure closed lookup
             ▼
named GestureProposal[]
             │ user chooses one
             ▼
ActionPlan / SemanticLinkDraft / CompositionDraft / ConstraintDraft
             │
             ▼
Permission Broker guard(planDigest, level)
             │
      authorised effect only
```

The deterministic mappings are:

| Drag subject | Drop target | Exact proposals |
|---|---|---|
| Claim | Claim | Supports · Contradicts · Connect |
| Claim | Object | Inform a design decision |
| Decision | Object | Attach as influence (`satisfies`) |
| Object | Print zone | Prepare for print |
| Object | Delivery zone | Validate → package → review sheet |
| Version | Version | Compare |
| Image or file | Object | Add as source · Add as reference form |
| Passage | Question lane | Create a Knowledge Object |
| Object | Object | Composition relationship |

`proposalsFor()` has no persistence or effect dependency. `chooseProposal()` calls the permission guard before an injected apply function. A PURCHASE-level plan is refused without authorisation just as it would be when initiated through language.

Every pointer gesture must expose a focusable source, a focusable target, a keyboard command that reaches the same resolver, a visible proposal chooser, and an escape/cancel route. Pointer hover can enrich feedback but cannot be the only way to reveal an action.

---

## 11. Typed Constraint Objects

Migration 11 stores the constraint definition in `constraints`; the current value lives in the Object's version properties. Constraint edits therefore version, undo, redo, and participate in impact like other Object changes.

Seven definitions are supported:

| Kind | Definition | Valid value shape |
|---|---|---|
| range | min, max, step, unit | number on the allowed step within bounds |
| enum | at least two options, multiple flag | one option or allowed option array |
| boolean | no extra definition | boolean |
| date_range | earliest, latest | valid start/end timestamps within bounds |
| location | explicit place fixtures | one or more allowed place identifiers |
| priority | at least two named dimensions | bounded values for known dimensions |
| quantity | integer min/max and unit | integer within bounds |

A write is validated against its own definition before a new version exists. A quantity cannot contain a date; a range cannot exceed its ceiling; an enum cannot store an unknown option.

Constraints attach with semantic links using review-on-change semantics. Changing a constraint updates renderer state, recompiles the Situation, and can remove excluded choices while preserving layout identity and slot order. The visible strip describes units explicitly; currency, distance, nights, and people are never inferred silently.

---

## 12. Durable change semantics

XENIUR keeps two kinds of change visually and structurally separate:

- **Rebuild** is mechanical lineage. A source form or recipe input changed, so derived forms are stale and can be recomputed. It uses blue.
- **Review** is semantic influence. A source, Claim, Decision, or constraint changed, so a human judgement should be revisited. It uses amber.

The signal lime is not borrowed for either state. Lime means focal identity, commitment, trustworthy active state, and deliberate brand energy. This prevents the interface from collapsing all positive or important things into one ambiguous colour.

`impactOf()` returns rebuild and review sets with causal paths from the existing graph. The grammar only visualises that result; it does not recompute impact. A source change can therefore mark a Decision for review while leaving jacket forms valid, and a mesh change can mark thumbnail/turntable/delivery for rebuild while leaving the Decision untouched.

---

## 13. Electron application architecture

### 13.1 Renderer state machine

`App.tsx` owns a small explicit view union:

```ts
type View =
  | { kind: "home" }
  | { kind: "world"; snapshot: WorldSnapshot }
  | { kind: "object"; detail: ObjectDetail; worldSnapshot: WorldSnapshot }
  | { kind: "focus"; objectId: string; minutes: number }
  | { kind: "web" }
  | { kind: "workflows" };
```

It also owns global task state, system information, busy/notice state, command-palette visibility, economy state, and the currently offered compute quote.

On mount it loads Worlds, active tasks, system information, and economy configuration. Task events are pushed from the queue. Completed or failed work refreshes the visible World/Object. Focus Mode intentionally ignores those events so quiet mode does not become a notification surface.

Intent submission has two outcomes:

- local/non-metered work is accepted into the normal path;
- expensive generation returns a quote and opens `ComputeReview` before queuing.

The renderer never fabricates a balance, quote, task result, or readiness state.

### 13.2 Home

Home is a visual work index, not a prompt portal and not a dashboard of subsystem metrics. Its first screenshot must communicate “my Worlds and active situations,” not “ask an AI.”

Its hierarchy is:

1. XR brand mark and the product thesis;
2. navigation to Protected Web and trusted Workflows;
3. the `Work in view` workbench header with New World and Bring in a source actions;
4. existing Worlds as the dominant large folder-shaped work containers;
5. active visual situations alongside the Worlds, including inline human review when required;
6. the Local / Intelligence / Compute economic model band;
7. a factual provenance-centered footer.

There is intentionally no large prompt field on Home. Language remains available through Command-K and inside a selected World, where focus, goal, and scope already exist. This removes the most dangerous prompt-first ambiguity: a blank global field cannot silently become the product's apparent centre of gravity.

#### Workbench composition

The workbench header is editorial and asymmetrical: a small orientation label, a large condensed statement, one high-confidence lime primary action, and a quieter source action. It does not animate independently from the content it introduces.

The main grid allocates most width to Worlds and a narrower fixed reading column to active situations. The active board shows only non-terminal tasks. Each entry begins with the World name, then the human task title, then state/detail. `needs_approval` entries expose Review and Decline where the task appears instead of duplicating a disconnected notification centre. When nothing is active, the empty state directs the person back to Objects, choices, and visible actions rather than suggesting a prompt.

At smaller widths the board follows Worlds in source order. No information is hidden behind hover and no masonry rearrangement changes the reading sequence.

#### Folder cards

Worlds are rendered as accessible `motion.button` folder cards. The full silhouette is the hit target. A single root variant coordinates lift, front-panel movement, and cover drift. Container-relative CSS units keep the silhouette proportional. Reduced motion disables the spring. If no image exists, the cover uses a code-native XR graphic field rather than a network stock image. The folder metaphor is functional: a World is a durable container that opens, not a generic rounded card advertising a feature.

The project is TypeScript, Tailwind 3, and shadcn-compatible. `components.json` maps reusable UI to `apps/desktop/src/renderer/components/ui`, utilities to `renderer/lib/utils.ts`, and styles to `renderer/tailwind.css`. React Server Components are disabled because this is Electron. Tailwind preflight is disabled so it cannot reset the established Scene/UI CSS. Product styling still lives primarily in the explicit design system rather than being scattered through utility strings.

### 13.3 World: the three-zone workbench

The World retains a stable three-zone shell:

```text
┌──────────────────────────────────────────────────────────────┐
│ Back · XR · World title · FOCUS: current thing               │
├──────────────┬──────────────────────────────┬─────────────────┤
│ Sources      │                              │ What is it?     │
│ Decisions    │     compiled Scene           │ Why this?       │
│ Work         │     focus stays centre       │ What changed?   │
│ Deliveries   │                              │ Is it ready?    │
│              │                              │ What next?      │
├──────────────┴──────────────────────────────┴─────────────────┤
│                    Use language for this   ⌘K                 │
└──────────────────────────────────────────────────────────────┘
```

The left rail names project concepts, never XENIUR subsystems. Each zone supplies a semantic intent:

| Zone | Goal | Meaning | Interaction | Layer |
|---|---|---|---|
| Sources | understand | relationship | connect | 2 |
| Decisions | decide | relationship | review | 3 |
| Work | transform | relationship | choose | 2 |
| Deliveries | deliver | relationship | commit | 3 |

The extra goal column is not decorative metadata. It participates in layout identity and tells the compiler why the same focused Object is being shown in this zone.

The centre holds one selected thing. Selecting the Decisions zone explicitly moves focus to the first Decision when available. The right inspector is itself a small Scene containing `InspectorQuestions`, so it uses the same closed rendering boundary.

World resolves thinking maps, friction, decisions, impact, constraints, and process proof through the bridge, builds `SceneBindings`, constructs a validated Situation, and runs both compilers. It may prepend a pending `ApprovalDialog` or an explicitly requested `CausalPath`, but it does not hand-author the primary visual structure by tab name.

Drag targeting invokes the shared grammar resolver. Choosing a proposal records `gesture_used`, then asks the bridge to process the exact chosen relationship. Language is a compact dock integrated into the lower edge of the work surface. Its resting state is the secondary action “Use language for this,” not an always-open composer. Opening it preserves the current focus/goal/scope and submitting records `typed_instead` with the current meaning but never records the text. Escape closes it and Command-K offers the global keyboard peer.

When no Object exists, the centre has a clear `ImportDrop` empty state. It does not compile a fake focus.

### 13.4 Living Object view

The Object surface begins with identity and condition:

- back to World;
- compact XR mark;
- Object title and semantic type;
- version and branch;
- count of stale recipe steps;
- View/share process;
- export `.xeniur`.

Its tabs describe human modes rather than data tables:

| Tab | Grammar input | What it is for |
|---|---|---|
| Forms | relationship + choose, layer 2 | Work with current representations |
| Compare | relationship + compare, layer 3 | Understand a revision side by side |
| Evidence | relationship + review, layer 3 + ready | Inspect checks and readiness |
| History | sequence + connect, layer 3 | Understand versions over time |
| Show how this happened | relationship + review, layer 4 | Reveal recipe, lineage, provenance, and causes |

The view refetches impact whenever Object detail changes so its rebuild/review headline cannot describe stale state. Constraint changes go through the typed write path and then refresh the Object. Process sharing is unavailable until a proof summary exists.

### 13.5 Focus Mode

Focus Mode replaces the application shell rather than merely hiding it. It shows one compiled `FocusView`, an optional countdown, and one obvious exit. Escape exits. It makes no claim to silence the operating system; it only quiets XENIUR. Task push events are ignored while active.

### 13.6 Command palette

Command-K / Control-K opens a context-aware palette. It includes World navigation everywhere and adds Object operations only while an Object is open: rebuild stale work, validate, undo, redo, export, and enter Focus Mode. Arrow keys move through results, Enter runs the selected command, and Escape closes. The palette is a faster peer to visible controls; no essential action exists only there.

### 13.7 Global overlays and messages

- Notices use `role="status"`, plain language, and a dismiss action.
- Compute Review is modal and blocks queueing until confirm or cancel.
- Process Share is modal and begins with no private event selected.
- Approval dialogs come from actual parked tasks.
- Busy labels describe the current transition (“Working…”) and disable duplicate submission.
- Bridge absence produces a truthful unavailable state. The sample visual preview is allowed only on localhost with the explicit preview query.

---

## 14. Protected Web Layer

The application offers three visibly distinct modes because reading, viewing, and acting have different risk and authority.

### 14.1 Explore: default

Explore is for articles, research, products, references, documentation, discussions, papers, and listings. The main process fetches the page, extracts useful inert text, stores it as a Source/Living Object, and returns an inspectable capture summary.

The interface shows:

- normalized URL and title;
- source hash prefix;
- risk wording;
- readable excerpt;
- candidate knowledge-atom count;
- the World receiving the Source.

It does not run website JavaScript, submit forms, retain cookies, or reproduce site navigation. Candidate knowledge is not silently accepted as fact.

Fetch rules:

- HTTPS only, default port 443;
- embedded credentials rejected;
- localhost, loopback, link-local, private, reserved, local-name, and internal destinations rejected;
- DNS is resolved and every result must be public;
- the checked destination is pinned for the TLS connection while retaining correct hostname verification;
- no cookies and no automatic redirect following;
- at most four redirects, each fully rechecked;
- HTML/plain text only, maximum 2 MB, 15-second timeout;
- active and interface elements—including scripts, styles, forms, controls, frames, objects, navigation chrome, SVG/canvas, and templates—are removed with a real parser.

### 14.2 Live Site

Live Site is used only when the actual webpage matters. React displays XENIUR's controls and an isolated `WebContentsView` occupies measured bounds below them.

The view uses:

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
no preload
no window.xeniur
no webview tag
safe dialogs
ephemeral partition
```

Permissions, downloads, popups, new windows, webviews, unsafe schemes, non-GET/HEAD navigation, and uncontrolled redirects are denied. Top-level and subframe destinations are checked. A response policy adds a restrictive form/object/base CSP. Bounds follow resize and scroll; the view is closed when the React surface unmounts.

The session uses a local validating CONNECT proxy. The proxy accepts HTTPS port 443 only, resolves and checks the destination again, connects to a pinned public IP, and closes rather than allowing DNS rebinding.

Remote content never receives the privileged preload, and the trusted IPC layer also rejects senders from browsing partitions.

### 14.3 Act

Act is reserved for consequences such as Reserve, Send, Submit, Buy, Publish, and Upload. Page text remains `UntrustedContent`: it may contribute facts to a proposed plan but cannot approve that plan.

The interface fails closed until Hands has produced a concrete Action Plan. Only then can it render a XENIUR-native Review Sheet containing the outcome, data being sent, account, destination, price, site, reputation wording, and permission controls. “No listed threat detected” is deliberate; “safe” is never shown.

### 14.4 Reputation privacy

Reputation mode is configurable:

- **Local only** does not send the URL to Google and makes no external reputation claim.
- **Google lookup** sends the full URL and is exposed only when configured.

The disclosure is visible in the Web footer. Listed threats and unavailable mandatory checks block navigation. Cached results are bounded and short-lived.

---

## 15. Compute and intelligence economics

XENIUR separates three economic layers:

| Layer | User promise | Examples |
|---|---|---|
| Unlimited Local | Always unmetered because the user supplies the machine | Blender, FFmpeg, local transforms, Scene compilation, graph operations, local validation |
| Included Intelligence | Generous rolling and reserve capacity; normally low-friction | intent interpretation, Scene planning, constraint help, source assistance, lightweight reasoning |
| Metered Generation | Visible before work because marginal cost is meaningful | image, video, 3D, deep remote research, remote workers |

If economy configuration is absent, the UI says it is not configured. It does not invent `524` credits or a dollar rate.

### 15.1 Quote lifecycle

```text
plan requests generative provider
            │
            ▼
quote: units + provider + optional USD + current balance
            │ 10-minute, one-use, plan-bound
        user confirms
            │
     reserve estimated units
            │
       queue authorised task
            │
   settle actual ≤ estimate
            │
 refund unused reservation
```

The quote fingerprint includes tool, arguments, Object IDs, current versions, provider, and price. Changing the plan or current Object version invalidates the quote. Quotes move through offered, queued, reserved, settled, or cancelled states. The ledger never lets actual cost silently exceed the estimate.

### 15.2 Compute Review frontend

The modal names the exact operation and shows:

- Compute units;
- provider;
- approximate dollar equivalent only when a trusted conversion exists;
- current balance and insufficient-balance state;
- the fact that the result will carry the appropriate AI/model provenance;
- a local 0-Compute alternative when one exists;
- Cancel and an explicit action-labelled confirmation.

Confirmation is disabled when the quote is stale, insufficient, or already being processed. Cancelling cancels the held offer rather than simply hiding the dialog.

---

## 16. Process Provenance and Proof of Process

Migration 12 adds a factual, append-only process ledger. It records how an Object came into existence without reducing authorship to an “AI-made/human-made” badge and without making legal ownership claims.

Events can describe:

- sources collected;
- notes and sketches recorded as user-created when their actor is human;
- Claims and accepted Decisions;
- rejected experiments;
- manual edits and revisions;
- tools and models used;
- AI-assisted steps;
- recorded XENIUR sessions and their recorded duration;
- produced and consumed versions;
- delivery and validation milestones.

Each event has a human/tool/model actor classification and can carry version/hash/timing facts. A summary can truthfully say, for example, “3 sketches recorded as user-created / 7 researched sources / 4 accepted human decisions / 6 manual revisions / AI used at 2 recorded steps / 2 recorded XENIUR sessions (47 min recorded).”

The vocabulary is intentionally strict:

- `xeniur_session` means a bounded session explicitly recorded by XENIUR, not total elapsed labor;
- recorded session duration is not interpreted as attention, difficulty, craft, or productivity;
- `sketch_made` plus a human actor supports “recorded as user-created,” not “original”;
- time in Blender or on paper outside XENIUR is absent unless the person deliberately adds a factual source/event;
- an idle open application must not be converted into an effort claim;
- process evidence describes provenance and authorship context, not copyright ownership.

Migration 14 normalises legacy `working_session` events to `xeniur_session`. Count fields are named `recordedXeniurSessions` and `recordedSessionMs` so downstream UI cannot accidentally imply more than the ledger knows.

### 16.1 Process Share frontend

The share dialog is privacy-first:

1. no events are selected on open;
2. the creator sees local event labels, actor, and date;
3. the creator deliberately selects publishable events;
4. hashes and recorded XENIUR session timing are separate opt-ins;
5. export is disabled until at least one event is selected;
6. the result reports the exported path and root SHA.

The public artifact removes prompts, source text, filenames, tool names, model names, private labels, and unselected events. It uses generic factual labels, contains no script or remote assets, and includes a restrictive CSP plus a verifiable manifest. Its disclosure states that timing covers recorded XENIUR sessions only and that hashes do not establish originality. The page may offer “Open this project in XENIUR,” creating a product loop without turning XENIUR into a feed.

### 16.2 Derivation notices

When one recorded Object derives heavily from another, XENIUR may surface evidence and invite attribution, licensing, or transformation disclosure. The flow is:

```text
detect relationship → present evidence → human decides → optional action
```

The UI calls it a possible derivation, never a proven theft or infringement.

---

## 17. Action Receipt Objects

Process Provenance explains how an artifact came into existence. Action Receipts apply the same philosophy to what XENIUR attempted in the outside world. A booking, submission, publication, upload, sent file, or purchase must not vanish into browser history or a transient toast.

Migration 14 adds `action_receipts`. Each successful consequential browser completion with a receipt creates one `action_receipt` Living Object and one typed query row containing:

| Fact | Meaning |
|---|---|
| `attempted` | Human-readable action that was attempted, not a claim that it succeeded. |
| `planDigest` | SHA-256 of the exact tool, arguments, Object/destination context authorised for execution. |
| `accountSessionId` | Scoped session grant used, nullable when no account session existed. |
| `destination` | Provider, site, or external destination. |
| `dataSent[]` | Field names, value types, and hashes of exact values; sensitive values are not duplicated into the receipt. |
| `quotedPrice` | Price shown before action when one existed. |
| `actualPrice` | Settled observed cost after action. |
| `providerResponse` | Status, reference, and digest of the returned response. |
| `at` / `outcome` | Recorded timestamp and factual succeeded/failed/refused/partial/unknown state. |

The Object carries traits `external + consequential + deliverable + versioned`, uses the primary acted-on Object as its parent when available, and stores the receipt facts in normal versioned Object properties. The typed table enables destination/action queries; the version snapshot makes export and ordinary Object inspection self-describing.

Hands constructs the receipt from the exact plan it sends through the Permission Broker. Field values are available only long enough to perform the action and calculate their hashes. Public receipt data gets names, types, and digests. A later verifier can compare a deliberately supplied value with the digest without XENIUR publishing that value.

The receipt is evidence, not authority. It is created after the action record is completed and cannot retroactively approve a plan. Object/version creation and the typed receipt row are wrapped in one database transaction. Repeating `record(actionId, receipt)` is idempotent, so retries do not create multiple histories for one action. Receipt creation participates in the durable graph path rather than renderer state.

### 17.1 Receipt frontend contract

The current generic Living Object view can inspect and export receipt properties. A dedicated receipt Scene should reuse `ReviewSheet`, `EvidenceMeter`, and timeline primitives rather than create an invoice-like browser page. Its recommended order is:

1. outcome and attempted action;
2. destination and account/session identity;
3. quoted versus actual price;
4. named data fields sent, with values private by default;
5. provider status/reference;
6. plan and response digest verification;
7. relationship back to the affected Object.

The UI must use “attempted,” “reported,” and “recorded” precisely. A provider response such as `confirmed` is displayed as the provider's response, not independently vouched for by XENIUR.

---

## 18. XCDL: the capability language

XENIUR Capability Definition Language is the developer-facing composition layer for the AI era. Developers describe what a trusted capability accepts, what semantic traits it requires, which visual meanings expose it, which permission it needs, which host-owned adapter executes it, and what Living Object it produces. They do not ship arbitrary UI into the visual kernel.

```ts
{
  format: "xeniur-capability/1",
  capability: "hotel.reserve",
  title: "Reserve hotel",
  accepts: [
    { name: "Hotel", traits: ["locatable", "priced", "temporal", "bookable"] },
    { name: "Dates", traits: ["temporal"] },
    { name: "People", traits: ["personLike"] },
    { name: "PaymentMethod", traits: ["external"] }
  ],
  traits: ["external", "priced", "consequential"],
  permission: "PURCHASE",
  inputSchema: {
    quotedPrice: { type: "number", required: true, min: 0, unit: "USD" }
  },
  visualSemantics: {
    where: "map", when: "calendar", who: "people", cost: "review"
  },
  execution: {
    adapter: "xeniur.hands", operation: "browser.submit", version: "1"
  },
  produces: {
    semanticType: "reservation_receipt",
    traits: ["external", "consequential", "deliverable", "versioned"]
  }
}
```

### 18.1 What the language may express

- named semantic subjects and the traits each subject must satisfy;
- bounded scalar/enum/Object-reference inputs;
- capability traits such as external, priced, consequential, deterministic, or generative;
- a permission floor;
- visual aliases mapped to existing closed Scene primitives;
- one host-owned, versioned adapter and one existing Tool operation;
- the semantic type and traits of the produced Object.

### 18.2 What the language cannot express

- React components, HTML, CSS, canvas instructions, or design tokens;
- JavaScript, shell, SQL, Python, URLs, selectors, preload code, or network code;
- a new permission level, new Tool name, new trait, or new Scene component;
- an adapter that the host did not install and trust;
- a permission lower than the underlying Tool baseline;
- a consequential capability below `COMMUNICATE`;
- an external operation that hides its external trait.

`CapabilityRegistry` parses strict manifests, verifies adapter allowlisting, checks permission monotonicity, maps visual aliases to the closed registry, canonicalises and hashes the manifest, and stores it by capability identifier. At planning time it checks that every required subject exists and satisfies its traits, validates each declared value, and emits a normal `ActionPlan`. The Permission Broker remains authoritative; manifest permission is a floor, never approval.

### 18.3 Compiler relationship

```text
XCDL manifest
   │ schema + trusted adapter + permission checks
   ├──────────────→ visual aliases → existing Scene components
   │
selected Objects + values
   │ trait/value validation
   ▼
ActionPlan → Permission Broker → trusted adapter → Action Receipt Object
```

XCDL and Scene JSON are complementary languages. Scene JSON declares a trusted view. XCDL declares a trusted capability binding. Neither language contains executable presentation or authority. Together they let developers expand what XENIUR can do without fragmenting the experience into plugin-owned mini-applications.

---

## 19. Trusted workflow exchange

The initial workflow library shares reusable visual work structures without executable plugin code.

A strict `xeniur-workflow/1` manifest can contain:

- Visual Scene structure;
- constraints and initial values;
- a recipe made only from allowed capabilities and argument shapes;
- readiness profile;
- Decision template;
- delivery/form roles;
- bounded sample Objects;
- human-readable instructions, author, and summary.

The validator bounds manifest size and rejects unknown fields, private Decision references, candidate-generation steps, arbitrary tools, and recipe arguments outside the allowlist. Current allowed recipe tools are intentionally narrow: trusted image transforms, selected 3D solidify/export/render/turntable operations, and manual document writing.

Applying a workflow creates a real World, Objects, recipe, settings, samples, Decision structure, and typed Constraint Objects. Constraints attach with review-on-change semantic links. Installation identity is a deterministic manifest hash.

### 19.1 Workflow Library frontend

The library presents bundled and installed workflows as a responsive card grid. Each card names source, step count, title, author, summary, and the “Use workflow” action. While one apply operation is active, duplicate application is disabled. Success opens the created World. A prominent note explains that workflows are data-only and cannot run arbitrary plugin code.

Ratings, payments, revenue sharing, remote discovery, and enforcement services are future marketplace infrastructure, not current claims.

---

## 20. Frontend visual language

### 20.1 Brand identity

The canonical mark is `brand/XR_logo_vector.svg`, rendered by `BrandMark` rather than recreated with a generic icon. The identity expands from its geometry:

- **XR monogram:** compact, engineered, and legible in the rail, header, and proof surfaces;
- **signal lime `#C6F939`:** energy, focus, commitment, and active identity;
- **graphite/green-black:** a quiet field that lets Objects and evidence carry attention;
- **paper white:** primary reading colour;
- **condensed constructed display type:** wide editorial statements and technical confidence;
- **square geometry and visible structural rules:** the interface feels built, not decorated.

The preferred display stack is `Avenir Next Condensed`, then `Arial Narrow`/`Roboto Condensed` and system fallbacks. Body copy uses `Avenir Next`, Helvetica, and system sans. Hashes, versions, and machine facts use a monospace stack. The application requires no external font request.

### 20.2 Core tokens

| Token | Current role |
|---|---|
| `--xr-bg: #0b0d0c` | application field |
| `--xr-surface: #121513` | primary surface |
| `--xr-surface-2` / raised surfaces | secondary grouping and lifted controls |
| `--xr-text: #eef0e9` | primary text |
| `--xr-dim: #a2a89e` | secondary copy |
| `--xr-faint: #747b72` | tertiary metadata |
| `--signal: #c6f939` | semantic focus/commitment |
| `--brand-lime: #c6f939` | decorative identity use kept separately auditable |
| rebuild blue `#7aa7d8` | mechanically stale forms |
| review amber `#d8a75f` | human judgement required |
| blocked grey `#8b8fa0` | unavailable/blocked |
| danger `#d9694a` | errors and destructive warning |
| ready green `#7fae8c` | validated settled state |

Even where the values match, `--brand-lime` and `--signal` remain separate tokens. Brand decoration can evolve without silently diluting a semantic state.

### 20.3 Neo-brutalist expression

XENIUR uses neo-brutalism as structural honesty, not as visual noise:

- hard borders expose grouping;
- offset shadows communicate lift and press;
- large condensed headlines create editorial hierarchy;
- square or lightly chamfered surfaces dominate;
- labels are direct and verbs are specific;
- asymmetry appears in hero/editorial composition, not in controls that must remain predictable;
- high contrast is tempered by calm interior Object views;
- decorative gradients are avoided; depth comes from planes, rules, texture, and motion.

Older functional interior components may retain small radii where they improve scanability. The product shell and new grammar surfaces avoid generic nested rounded-card stacks.

### 20.4 Spacing, density, and hierarchy

- Major shells use broad gutters and strong divisions.
- Scene content gets more space than navigation or metadata.
- Primary headings use compact line-height and controlled width rather than wrapping into long narrow towers.
- Metadata uses uppercase/monospace sparingly.
- Controls are at least comfortably targetable and do not depend on icon-only meaning.
- A section earns a border, surface, or shadow only when it expresses grouping or interaction.
- Cards do not contain repeated card-within-card ornament.

### 20.5 Motion and parallax

Motion explains depth, causality, and direct manipulation:

- folder lift reveals that a World can be opened;
- panel and cover move from one shared spring so they feel physically connected;
- Object/Scene planes may use shallow parallax only when it clarifies spatial relationship;
- selected, changed, and proposal states may pulse or settle;
- modal and palette transitions preserve spatial origin;
- drag feedback marks both source and eligible target;
- focus never changes as a side effect of animation.

Motion uses transforms and opacity, remains interruptible, and avoids long autonomous sequences. Hover animation is enabled only under `(hover: hover) and (pointer: fine)`. Under `prefers-reduced-motion`, transitions collapse to effectively immediate state changes and the ambient canvas becomes static/quiet.

### 20.6 Responsive behavior

The desktop shell is designed for a wide workbench, then adapts intentionally:

- above roughly 1050 px, Home uses its full editorial composition and multi-column card/economy layouts;
- below that range, the Worlds and active-situations workbench becomes one column, World/workflow cards reduce to two columns, and the economy band stacks;
- at 760 px and below, minimum width drops to 320 px, grids become single column, large display type clamps down, actions wrap, and modal/panel padding reduces;
- Scene semantics and source order remain unchanged across breakpoints;
- touch users receive visible controls rather than hover-revealed affordances.

Electron remains the primary target. These responsive rules support smaller windows and preview surfaces; they do not constitute untested Windows/Linux/mobile product promises.

### 20.7 Accessibility

Every visual flow must also work through semantic controls:

- native buttons and inputs are preferred;
- folder cards are buttons, not clickable `div`s;
- drag operations have keyboard equivalents reaching the same proposal function;
- focus rings remain visible against graphite;
- the command palette traps intent but Escape always exits;
- dialogs have an obvious cancel route;
- live status is used for notices/focus labels, not the ticking focus timer;
- colour is never the only rebuild/review/conflict signal;
- readable contrast is preserved for text and critical boundaries;
- the semantic Scene twin reports concepts and values;
- reduced motion is honored both in Framer Motion and ambient canvas code.

### 20.8 Frontend component and state ownership

The frontend is deliberately split by state lifetime:

| Concern | Owner | Why |
|---|---|---|
| navigation, global tasks, command palette, compute quote | `App.tsx` | Crosses page boundaries but remains renderer-transient. |
| selected zone, selected Object, language dock, proposal chooser | `World.tsx` | Meaningful only inside one World session. |
| Object tab, form role, process-share visibility | `ObjectView.tsx` | Meaningful only for the inspected Object. |
| compiled visual tree | `compileSituation` + `layoutScene` | Derived state; never stored as an independent project database. |
| Object/Decision/constraint/action/process truth | main-process graph and stores | Durable, transactional, reload-safe. |
| task execution and approvals | task queue + Permission Broker | Authority cannot depend on React state. |

Every page follows the same loading discipline: keep the last truthful snapshot visible when safe, disable the initiating control during a duplicate-sensitive transition, and show a concrete busy label. Empty states are part of the information architecture, not decorative illustrations. Error copy names what did not happen and preserves a route back.

### 20.9 CSS and reusable component architecture

`styles.css` holds product-level named classes and semantic tokens. `tailwind.css` exists for shadcn-compatible utilities and reusable `components/ui` pieces, with preflight disabled. This prevents a utility reset from unpredictably changing Scene primitives while still allowing carefully isolated component integration.

Reusable UI belongs in `renderer/components/ui` when it has a stable prop API, accessible behavior, and no World-specific data fetching. Product surfaces keep composition near the page that owns it. `FolderCard` accepts presentation facts and an activation callback; it does not know how Worlds are loaded. `BrandMark` owns the supplied SVG geometry; pages choose only size/context. `AetherFlowHero` remains a reusable visual specimen but is no longer the Home hierarchy because an intent-field hero would contradict the product model.

The styling cascade is ordered conceptually as:

```text
root tokens → shell/layout primitives → Scene components → page compositions
            → reusable UI blocks → responsive adaptations → reduced motion
```

New styles must reuse semantic color tokens, avoid global element overrides, retain visible `:focus-visible`, and be tested at the supported wide, medium, and narrow window states.

### 20.10 Visual priority and language parity

The interaction priority is:

1. touch, move, select, compare, or adjust the visible semantic thing;
2. choose a concrete proposal or review sheet;
3. use language when it is faster;
4. inspect machinery only when explanation requires it.

This is not a ban on language. It is a hierarchy test for every new surface. A large empty composer above available Worlds fails the test; a compact “Use language for this” action attached to a focused visual situation passes it. Command-K remains globally discoverable, and typed work reaches the same plan, quote, permission, and provenance paths as direct manipulation.

---

## 21. IPC and desktop security

The preload exports named methods grouped by product capability. It never exposes raw `ipcRenderer`, a generic `invoke(channel, payload)`, Node.js, filesystem APIs, or Electron objects.

Every IPC handler:

1. verifies the sender is the trusted main renderer and main frame;
2. rejects browsing partitions and unexpected URLs/webContents IDs;
3. parses input through its channel-specific Zod schema;
4. invokes a service with already validated data;
5. returns a typed result.

This sender check occurs even when a channel takes no meaningful payload. Generated or remote web content has no privileged preload, and even a message attempt from it fails sender verification.

Consequential actions retain the Permission Broker boundary. The human authorises the plan digest, not a mutable label. Preview and effect derive from the same plan so the description cannot drift after approval.

---

## 22. Data and UI update lifecycle

The main renderer follows a snapshot-plus-targeted-refresh model:

```text
open World → WorldSnapshot
select Object → detail + targeted impact/proof/constraints
change constraint → validated version write → local binding update → refresh/recompile
task event → refresh active tasks → refresh visible World/Object on terminal state
change tab/zone/focus → new Situation → pure compile/layout → render
```

Transient frontend state is limited to view choice, current focus/zone/tab, open overlays, typed draft text, chosen form role, gesture proposal selection, and loading/busy feedback. Durable work belongs in the graph or task queue.

This prevents React state from becoming a second project database. Reloading the renderer may reset navigation, but it must not lose Objects, Decisions, constraints, process events, task state, or quotes already persisted by the host.

---

## 23. Instrumentation

The metrics boundary records interaction shape, not user content.

| Event | Stored | Explicitly not stored |
|---|---|---|
| `gesture_used` | completed visual act and concept | dragged content, source text, private labels |
| `typed_instead` | the concept for which a visual path existed | the utterance itself |

Two diagnostic rates are read together:

- **Visual-path usage:** how often a visual path was chosen when available.
- **Fallback-to-language:** when typing won and for which concept.

The product optimises interaction cost and comprehension, not the lowest possible typing rate. A high language rate may expose a missing visual grammar rule or may prove that language is the right interface for that situation.

`traced_cause` contributes evidence that a person inspected why something changed. Actual comprehension still requires user testing.

---

## 24. Flagship demonstrations

### 24.1 Rainwear 2027

`npm run demo:visual` compiles and renders one standalone scrollable HTML proof:

1. a canvas contains an interview, weather report, sketch, orange jacket, and presentation;
2. a passage becomes a Claim;
3. the Claim is dragged beside the jacket and proposes “Inform design decision”;
4. orange and black finish alternatives appear;
5. choosing orange creates Interview → Claim → Decision → Jacket;
6. changing the interview marks the Decision amber Review while jacket forms remain valid;
7. changing the mesh marks thumbnail, turntable, and delivery blue Rebuild while the Decision remains untouched;
8. dragging Jacket to Delivery produces a Review Sheet before approval.

The proof demonstrates thinking → decision → creation → dependency → revision → validation → outcome with almost no graph-reading.

### 24.2 Fixture travel proof

The same grammar renders location, calendar, people, cost, priorities, choices, itinerary, and review using fixture coordinates. Lowering the cost constraint removes excluded options and updates totals without network access or layout reshuffling. Nothing is booked.

---

## 25. Verification and quality gates

```bash
npm test
npm run typecheck
npm run demo:visual
npm run demo:revision
npm run demo:asset
npm run demo:sense
npm run e2e:loop
npm run preview:ui
npm run build
npm run dev
```

Required behavioral coverage includes:

- every allowed meaning/interaction resolves and every state has a modifier;
- goal/scope are required, scope world matches, focus is admitted, and out-of-scope context cannot influence compilation;
- trait combinations reuse the closed primitive table and remain deterministic;
- semantic compilation is deterministic and independent of layout policy;
- equal layout identity preserves slots and order across content changes;
- focus always occupies centre;
- unknown Scene components are refused;
- a drop changes nothing until one proposal is chosen;
- the chosen proposal reaches the broker and cannot bypass permission level;
- Claim-to-Claim offers exactly Supports, Contradicts, and Connect;
- wrong-shaped constraint values fail before version creation;
- constraint changes recompile and remove excluded options;
- source changes produce review without mechanical rebuild;
- mesh changes produce rebuild without Decision review;
- keyboard and pointer reach the same proposal resolver;
- semantic twins name concepts and values, not component names;
- `typed_instead` retains concept but not text;
- remote/browsing senders cannot use privileged IPC;
- Explore and Live redirect/destination rules resist private-network and rebinding paths;
- compute work cannot queue without a valid fresh quote;
- Process Share excludes unselected/private content;
- process summaries say recorded XENIUR sessions and user-created sketches without inferring total effort or originality;
- consequential browser completion creates one durable Action Receipt Object with plan, destination, hashed sent-data fields, price, response, time, and outcome;
- XCDL rejects executable fields, unknown adapters, trait mismatch, and under-declared permission while producing a normal broker-bound Action Plan;
- workflow manifests cannot smuggle executable or unapproved recipe behavior.

### Manual interface checklist

1. Complete Rainwear by pointer and then keyboard alone.
2. Confirm focus never changes silently and centre geometry does not rearrange during the task.
3. Ask why the Decision needs review and why the forms need rebuild without opening graph machinery.
4. Lower the travel budget and watch excluded options leave.
5. Traverse a Scene with a screen reader and listen for semantic concepts.
6. Enable reduced motion and confirm the ambient field, parallax, pulses, folder lift, dialogs, and palette remain understandable.
7. Resize through wide, medium, and 320 px layouts; verify source order, actions, and labels remain available.
8. Open Explore, Live, and Act and confirm their risk/authority differences are visible.
9. Start expensive generation and confirm cost, provenance, balance, and local alternative appear before queueing.
10. Export a proof with one event, then inspect that unselected content and names are absent.
11. Complete a fixture form action and inspect its Action Receipt Object; compare quoted and actual price and verify a deliberately supplied field against its digest.
12. Open Home at wide and narrow widths and confirm Worlds remain the visual hero while language stays available as a peer inside a focused World.

---

## 26. Extension rules

### Add a semantic trait

1. Demonstrate that the property recurs across multiple domains and is not merely a new semantic type.
2. Add it to the closed `SEMANTIC_TRAITS` contract.
3. Map it to one or more existing meanings without adding layout knowledge.
4. Verify trait order canonicalisation and component de-duplication.
5. Confirm it grants no authority by itself.

### Add a grammar combination

1. Reuse an existing meaning, state, and interaction if they describe the situation.
2. Add or refine a row in the closed resolution table.
3. Add totality and semantic-stability tests.
4. Verify keyboard affordances and the semantic twin.
5. Do not add geometry to `compileSituation()`.

### Add a Scene component

1. Prove that composition of the existing 46 primitives cannot express the concept cleanly.
2. Add its exact name to `SCENE_COMPONENTS`.
3. Add a strict node schema to the discriminated union.
4. Implement a binding-only React component.
5. Register it in `COMPONENT_REGISTRY`.
6. Add registry refusal/render tests and a `preview:ui` specimen.
7. Define reduced-motion, keyboard, empty, loading, and semantic-twin behavior.

### Add an XCDL capability

1. Choose existing subject traits and bounded value descriptors.
2. Map human meanings only to existing visual aliases.
3. Select a host-installed trusted adapter and existing Tool operation.
4. Declare a permission at least as strong as the Tool baseline; consequential capabilities require at least `COMMUNICATE`.
5. Declare the semantic type and traits of the output receipt/Object.
6. Test missing subjects, trait mismatch, bad input shape, untrusted adapter, under-declared permission, and successful Action Plan generation.
7. Route the resulting plan through the normal quote, Broker, execution, and Action Receipt path.

### Add an IPC capability

1. Define the request/response contract in core.
2. Add a named preload method; never add generic invocation.
3. Validate sender and payload in main.
4. Route consequences through plan preview and permission guard.
5. Record process/metrics facts only at the existing privacy boundaries.
6. If the action sends data or is consequential externally, require a structured receipt and persist its Action Receipt Object.

### Add a protected-web capability

1. Decide explicitly whether it belongs to Explore, Live, or Act.
2. Reapply URL/destination/risk rules after every redirect and navigation.
3. Keep page material untrusted.
4. Do not add the privileged preload to remote content.
5. Require a XENIUR-native Review Sheet before consequence.

---

## 27. Known limits and deliberate deferrals

- Real map tiles, geocoding, routing, booking, airline/hotel APIs, calendar accounts, payments, and ordering remain deferred.
- Reputation services have false positives, false negatives, availability limits, and privacy trade-offs; the UI states this honestly.
- Windows and Linux behavior is not promised by the current Electron proof.
- Model-chosen grammar dimensions, arbitrary plugin components, multi-user canvases, and executable marketplace extensions are deferred.
- XCDL currently compiles against installed trusted adapters and the existing Tool registry; remote capability discovery, signatures, publisher identity, and marketplace review are deferred.
- Action receipts are inspectable through Living Object properties; a dedicated receipt Scene is specified here but not yet a separate registered primitive.
- Workflow ratings, payments, revenue sharing, remote discovery, and creator enforcement are product directions, not implemented backend claims.
- User-test instrumentation exists; credible comprehension findings require unfamiliar participants.
- Proof of Process can verify disclosed hashes and recorded lineage. It cannot establish legal authorship or copyright ownership by itself.

---

## 28. Final invariant

Every layer should preserve the same relationship:

```text
human intent
    → explicit goal + bounded scope
    → trait-composed visible meaning
    → stable focus
    → inspectable proposal
    → explicit cost and authority
    → trusted execution
    → durable process or action receipt
    → understandable outcome
```

If a future feature makes the person manage prompts, providers, files, menus, APIs, browser risk, agent instructions, or credit ambiguity when the system can represent the meaning directly, it is moving away from XENIUR's architecture. The kernel exists to keep digital capability broad while the human interface stays visual, focused, truthful, and under human control.
