# XENIUR V1 — revised product and architecture plan

Proposed revision, **5 September 2026**. Based on the current repository and the [business strategy](/Users/developer/development/Xeniun/docs/XENIUR_STRATEGY.md). This document changes the plan; it does not imply that the proposed features are implemented.

**Release objective.** A creator imports an asset, produces checked delivery forms, revises the source, sees the affected outputs, rebuilds them without losing approved work, and exports a portable package. The workflow works with local deterministic providers and real imported assets. Mock generation remains an explicitly labeled demonstration mode.

Retain the full architecture scaffold. Treat **M1 completion as a verified engineering baseline** and **V1 release as a usable, narrowly scoped product**. Do not equate the presence of a package with an integrated feature.

**1. Product boundaries**

| Build into the first usable release | Retain behind capability availability | Defer until customer evidence |
| --- | --- | --- |
| Projects/Worlds; import; forms; source revisions; named variants; compare; undo; local image/mesh operations; dependency impact; checked export; portable history | Mock generation; existing video/code interfaces; browser shell and Hands; unavailable cloud adapters | Universal personal assistant; purchases/bookings; arbitrary generated applications; broad authenticated browser automation; multi-device collaboration; marketplace |

First target: static game props, with a Blender/GLB reference pipeline and one engine profile selected from recruited users. Keep the existing circle→rocket→mesh→STL test as a cross-modality regression. It is not the sole acceptance test for the product.

**2. Preserve these architectural choices**

- TypeScript workspace packages, runtime schemas, local SQLite/WAL, and content-addressed blobs.
- Stable object identity; immutable content; representation input/output roles; append-only version history.
- Deterministic tooling for deterministic operations; provider implementations outside renderer/data code.
- Explicit preload methods; privileged IPC sender and payload validation; untrusted content isolated from the World renderer.
- Declarative UI scenes drawn from a reviewed component registry. The initial twelve components are a starting set, not a permanent product limit.
- Visible background work, scoped authorization, receipts, and explicit unavailable states.

**3. Strengthen the domain model before adding more providers**

| Concept | Meaning | Required invariant |
| --- | --- | --- |
| Object | The user’s recognizable subject: Rocket, Trailer, Game | UUID survives changes of form; a new independent composition gets a related UUID |
| Representation | Immutable bytes in a particular form | Records direct production origin, parameters, and content hashes |
| Object version | Immutable snapshot of a coherent set of forms and object properties | Includes metadata and named representation slots; undo restores a whole state |
| Branch | A named, movable pointer to an object version | Independent candidates survive; committing never silently overwrites another branch |
| Recipe | A versioned description of how outputs are produced | Declares typed ports, dependencies, implementation, and replay policy |
| Run / action attempt | One actual execution of a step | Records exact inputs, resource reservations, execution state, costs, and outputs |
| Delivery profile | A versioned set of target requirements | “Ready” always names the profile, validator version, and evidence |
| Release / outcome | A recorded delivered state | Pins exact object versions, files, validation results, and destination/result evidence |

**Replace the single-form head assumption.** A useful Rocket state may simultaneously contain `source.mesh`, `concept.image`, `delivery.godot`, `preview.thumbnail`, and `preview.turntable`. Selecting the turntable must not make the mesh cease to be current. The UI’s selected form is view state, separate from the object version.

Keep `versions` as the history backbone. Add an immutable snapshot record per version containing object properties and a `version_representations(version_id, slot, representation_id)` mapping. Use explicit branch records and an expected base version for commits. Keep the old `representation_id` temporarily as a compatibility/default-view field during migration.

Migration must reconstruct each snapshot from its **parent snapshot**, not from global sequence order, so older branches do not inherit another branch’s changes. Old metadata history cannot be reconstructed if it was overwritten; label the migration boundary honestly. Reject cross-object version pointers and unsupported cycles. Make history immutability enforceable through repository constraints and, where appropriate, database triggers.

Store inter-object composition dependencies explicitly. The Game references an exact Rocket version for a release; it does not become another Rocket representation. Show newer versions as available updates without silently changing a delivered game.

**4. Introduce a small executable recipe graph**

The current `ActionPlan` is one tool call with largely untyped arguments. Keep an action as the atomic execution unit, and add a bounded recipe containing actions and dependencies. A small DAG is enough; a general workflow language is unnecessary for the first release.

```ts
// Proposed contract sketch; implementation uses discriminated Zod schemas.
type ReplayPolicy = "deterministic" | "candidate_generation" | "manual";

interface RecipeStep {
  id: string;
  capabilityId: string;
  capabilityVersion: string;
  inputs: Record<string,
    | { kind: "representation"; representationId: string }
    | { kind: "step_output"; stepId: string; port: string }
  >;
  args: unknown; // Parsed by the selected capability's strict argument schema.
  outputSlots: Record<string, string>;
  replayPolicy: ReplayPolicy;
}

interface RunRequest {
  objectId: string;
  branchId: string;
  expectedBaseVersionId: string;
  recipeVersionId: string;
  selectedSteps: string[];
  budgetReservationId?: string;
}
```

Resolve input slots to immutable representation IDs at run creation. Never resolve them later to whichever representation was inserted last. Capture the intended parent version before starting asynchronous work. If the branch changes while a job runs, retain the result as a candidate and report a conflict; do not attach it to an unrelated current head.

Support three initial recipes: prepare an imported prop for delivery; rebuild previews after a source revision; export a checked package. Keep recipes readable and versioned. Defer arbitrary user-installed executable steps.

**Change-impact semantics:** distinguish `source`, `style`, `mask`, `reference`, and other inputs. A changed input invalidates the dependent output according to its declared dependency policy. Initially use conservative invalidation whenever the relationship is uncertain. Represent states such as `current`, `outdated`, `pinned`, and `needs_review` as projections relative to a branch/recipe, not mutable facts on old immutable representations.

Deterministic steps may be rebuilt. Generative steps produce new candidates and require an appropriate cost/data policy. Manual edits stop automatic replay at an explicit checkpoint. A model must not erase a manual mesh repair by calling it a rebuild.

**5. Make provider contracts enforceable**

Each capability needs input/output schemas, accepted modalities, resource limits, possible effects, execution class, cost estimation, cancellation behavior, and validation hooks. A provider result is untrusted until parsed and checked.

Separate these dimensions; the current `external` boolean conflates them:

- Execution: in-process deterministic, isolated local worker, remote service, or mock.
- Data access: named input representations and explicitly permitted fields.
- Effects: local write, remote disclosure, remote mutation, communication, purchase, deletion.
- Reproducibility: cached exact bytes, repeatable local recipe, best-effort regeneration, or unavailable recipe.

Routing becomes: **eligible for this operation and policy → meets required quality/format → prefer deterministic execution → optimize cost/latency within limits**. Cheapness alone must not select an incompatible provider. Keep mock providers in an explicit demo profile; a production job must not silently fall back to a mock and appear successful.

Separate actual applied parameters from requested intent. Store source hashes, tool build/version, worker-code hash, adapter version, relevant settings, and provider request/job ID. Keeping an API model name and seed supports provenance but does not guarantee identical output in a later cloud call. Preserve original bytes as the exact recorded result.

Use blob/file handles for large outputs and stream hashing/writes where possible instead of copying every video or mesh into main-process buffers. Bound file sizes, image dimensions, decoded geometry, process output, time, and concurrent memory use. Keep one graph writer initially; execute heavy parsing/processing in workers. Main-process authority is not a reason to run every parser there.

**6. Transactional persistence and durable execution**

The unit of a successful graph commit is: output metadata + canonical input/output rows + materialized edges + applied parameters/cost + version snapshot + branch compare-and-swap + completion event. Persist these in one SQLite transaction after output blobs are safely staged.

The filesystem and SQLite cannot form one atomic transaction. Write blobs to temporary paths, hash and atomically rename them before committing references. Recover abandoned staging files and unreferenced blobs after a grace period. Use a transactional outbox for task events so a crash after commit does not hide completed work. Backup must cover a consistent database snapshot and the blobs it references; do not copy only a live WAL database file.

```mermaid
flowchart LR
  P["Validated plan"] --> A["Policy and resource reservation"]
  A --> J["Durable job attempt"]
  J --> W["Worker or provider"]
  W --> V["Validate and stage outputs"]
  V --> C["Atomic graph and branch commit"]
  C --> O["Outbox event and outcome"]
```

Queue states should distinguish `queued`, `running`, `needs_approval`, `needs_input`, `cancelling`, `cancelled`, `completed`, `failed`, and `outcome_unknown`. Persist attempts separately from logical actions. Store leases/heartbeats and provider job IDs when needed.

Crash recovery is **class-specific**. Requeue a safe deterministic operation using a stable logical key. Poll an existing remote job before starting another. Reconcile an uncertain external effect or require review; do not automatically replay a purchase, publication, or submission. Idempotency keys help only where the destination actually honors them. Do not promise exactly-once effects across arbitrary websites.

Pass an AbortSignal through router and provider calls into workers. Distinguish a request to cancel from confirmed cancellation. A cancelled worker cannot commit a new branch state; an already incurred remote charge still belongs in the cost ledger. Await actual worker termination before closing the database on shutdown.

**7. Cost policy before any paid execution**

Keep M1 offline. Do not treat the prices currently present in `config/providers.json` as verified by this report. No model IDs, credentials, or spending settings are changed.

Before enabling a provider, record a dated price source, exact model/API operation, units, currency, applicable account assumptions, and a tested estimator. Unknown cost is `unavailable` or requires a separately authorized capped quote; it is never zero.

Reserve worst-case or conservatively bounded spend transactionally across concurrent tasks, then settle actual usage. Include planning, retries, failed/billed requests, remote runtime, and provider-specific credits. Track credits by provider and unit; adding unrelated credit systems is meaningless. Use integer minor units with adequate precision or a decimal representation for money.

Maintain separate numbers for unique historical lineage cost, project/account spend, allocated delivery cost, and incremental rebuild estimate. A reused ancestor is counted once in one lineage traversal; showing it in two assets does not mean it was billed twice. Reserve independently of already settled costs to prevent concurrent overspend.

**8. Policy, identity, and browser boundaries**

Keep the existing seven permission labels for user explanation, but derive decisions from actual effects, destinations, data, reversibility, and scope. Remote model generation may be labeled CREATE while still uploading confidential files and spending money. A field fill can autosave or disclose data; a click can purchase. Six function names do not establish six safe effect classes.

For consequential work, replace `approved: true` with a stored approval grant bound to canonical plan hash, action ID, immutable inputs, destination/account, effect set, maximum amount, expiry, and one-time consumption. Revalidate immediately before execution. Changed price, input, recipient, or account invalidates the old approval. Keep the approval issuer in the trusted UI/policy path.

Untrusted-source labels must propagate through imports, summaries, and plans; they cannot depend on an optional caller boolean. Page text, recipe descriptions, and plugin metadata never mint authority. Prefer domain-specific/API adapters when operations can be defined more precisely than generic browsing.

Session access must load the stored grant by ID and check issuance, task, domain, identity, scope, expiry, and revocation on use. Reused contexts must be revoked/closed appropriately. In M1, an identity-dependent step should explain that signed-in automation is unavailable; approving it or signing into the visible browser cannot complete an unimplemented delegation feature.

Later, evaluate provider OAuth and a separate user-authorized automation login surface. A domain-scoped grant alone cannot turn arbitrary website cookies into a server-enforced least-privilege credential. Keep the original decision against silent cookie copying.

For Hands, empty allowlists must deny; validate final URLs and redirects; explicitly control subresources, downloads, local/private-network access, and account context. Persist action/receipt records through the same execution spine. Successful clicking is not evidence that a booking or purchase succeeded.

For Electron, use exact parsed origins/URLs and the registered Session object; avoid string-prefix origin tests and storage-path heuristics. Use a dedicated app protocol for packaged content. Keep popup handling fully denied unless a separate user action opens a validated external URL. Isolate generated previews by object/run, parse URLs exactly, explicitly restrict forms/frames/workers/network, and verify real behavior in Electron. These directions align with Electron’s recommendations on current releases, IPC validation, navigation, and isolation. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

**9. Output quality, provenance, and portable delivery**

Add validation profiles before claiming that an export is ready for downstream work. For the initial static-prop profile, report format parse validity, missing textures, triangle count, dimensions/units, transforms/pivot rules, materials, and an import check in the chosen target engine. Profile limits are project settings, not universal standards. Add visual acceptance by a person. Smoothing a mesh is not sufficient evidence of game readiness.

Keep STL as a secondary cross-modality fixture. Later printable profiles must consider manifoldness, scale, connected components, and fabrication-specific requirements. A binary STL length check cannot prove printability.

Track **direct provenance** and **inherited provenance** separately. A Blender conversion of a mock mesh is a deterministic step with mock ancestry. Show both in the UI and package. Human input and asset-license metadata need evidence, attribution, and an `unknown` state; they cannot prove ownership merely by existing in a row. Tamper-evident content credentials are a future interoperability option, not a substitute for that distinction. C2PA describes validation of provenance assertions rather than judgment of their truth or quality. [C2PA specification](https://c2pa.org/specifications/specifications/1.0/specs/C2PA_Specification.html)

A proposed `.xeniur` package is a documented archive of ordinary files plus a versioned manifest: object IDs, representation hashes, version snapshots, relationships, recipe versions, origin/rights records, and checks. Offer “delivery only” and “with history” exports. Redact secrets and private context; selectively include receipts, prompts, and source files. Verify hashes and reject unsafe archive paths and oversized expansion when importing. Omit ambient machine paths from portable references.

An exported release remains usable without XENIUR. Reimporting existing IDs must detect matching content, collisions, and intentional forks instead of overwriting a local project silently.

**10. Evolve existing packages without a rewrite**

| Package | Next responsibility |
| --- | --- |
| `core` | Strict per-tool schemas, snapshots/branches, effect declarations, recipe/run/validation contracts |
| `graph` | Current-state correctness; ownership invariants; atomic commits; full lineage cost; portable manifest queries |
| `tasks` | Durable attempts, state transitions, cancellation propagation, recovery and outbox delivery |
| `permissions` | Effect policy, plan-bound grants, cost/data disclosure decisions |
| `sessions` | Stored-grant verification and honest unsupported-identity behavior |
| `providers` | Runtime schemas, validated outputs, worker lifecycle, local resource limits, later real adapters |
| `router` | Policy-aware selection, budget reservations, staged output commit, validation orchestration |
| `brain` | Plans over available capabilities with immutable inputs; explicit unsupported/clarification results |
| `hands` | Maintain and test isolated adapter; integrate only after policy and receipts are ready |
| `ui` / desktop | Useful import-to-delivery controls, form/branch selection, impact preview, readiness and release views |

Implement recipe and validation modules inside existing packages first. Split new packages only when dependencies or independent reuse justify it. A later CLI can use the same application service layer. A later MCP adapter must call those services and policy checks; protocol connectivity is not application authorization. [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

**11. Release sequence and acceptance gates**

Indicative ordering for one experienced full-time engineer, with discovery in parallel. The windows are planning ranges, not a 90-day promise to ship every subsystem. Customer evidence can change the selected engine or stop expansion.

| Gate | Indicative window | Deliverable | Exit evidence |
| --- | --- | --- | --- |
| M1.1: trustworthy baseline | Weeks 1–2 | Repair current-head usage, lineage-cost accounting, grant validation, capability availability; stabilize test/build workflow | Regression tests cover reproduced defects; unsupported actions explain themselves; baseline remains green |
| M1.2: real local utility | Weeks 3–5 | Real imports; object snapshots/branches; direct transforms; compare; reliable export and package round trip | A new user completes an imported-asset delivery and returns to an earlier approved version |
| M1.3: revision product | Weeks 6–9 | Three recipes; change impact; safe deterministic rebuild; one delivery profile; worker cancellation/recovery | Source change rebuilds the correct descendants, preserves manual/pinned work, and passes actual target import |
| Pilot/release gate | Weeks 10–12 or later | Signed installer for the chosen supported OS; documentation; OSS release readiness; assisted team pilots | Repeated real use and payment evidence from the strategy; clean-machine install and recovery tests |
| M2: demand-led expansion | After gates pass | One verified real model adapter or optional managed review/execution, chosen by observed need | Paid integration has data/cost controls; hosted service has measured operating costs |

Keep macOS arm64 as the current development baseline. Validate pilot operating systems immediately; if target customers require Windows, schedule Windows packaging/runtime support before inviting them to depend on the app. A cross-platform framework does not mean the current hard-coded binary paths support all platforms.

Before enabling remote actions, finish plan-bound approval, budget reservations, effect-aware tools, and identity/receipt tests even if that delays their exposure. Local utility need not wait for broad browser automation.

**12. Expand verification around failure and change**

| Scenario | Required assertion |
| --- | --- |
| Undo, then transform | Both displayed form and execution input use the selected historical version |
| Two jobs start on the same branch | Both record the same intended base; one cannot silently become the other’s parent |
| Source edit with pinned/manual descendants | Correct outputs become outdated; pinned release stays unchanged; manual checkpoint is respected |
| Root generated without inputs, then transformed | All contributing actions are counted once, including root generation |
| Crash at each persistence boundary | No visible half-committed version; staged blobs/events recover consistently |
| Cancel during Blender or remote work | Worker stop is observed; cancelled work cannot advance branch; billed usage remains recorded |
| Two concurrent paid jobs | Combined reservations respect limits; unknown prices block execution |
| Mutate an approved plan | Changed destination/inputs/amount cannot reuse approval |
| Fabricated/revoked/expired/wrong-task grant | All refused; existing context does not retain authority |
| Empty allowlist, redirect, commit button disguised as click | No unapproved effect or escape from configured scope |
| Generated preview tries external navigation/form/frame | Exact origin and egress rules hold in real Electron |
| Export/import into clean data directory | Standard files are usable; IDs, hashes, snapshots, lineage, and checks round-trip |
| Invalid geometry that still parses | Readiness fails the relevant profile; user sees specific remediation |

Keep fast unit tests independent of locally installed Blender. Run binary/engine integration tests as an explicit suite with an environment probe. Add real Electron smoke tests; server-rendered React tests do not exercise browser isolation. Use a blocked-network test environment for an actual offline guarantee; the current offline fixture choosing local providers is useful but does not itself prohibit network access.

**V1 is complete when the revision-and-delivery job is dependable and demonstrably useful to the first customer cohort.** More providers, more components, and more package directories are not substitutes for that evidence.
