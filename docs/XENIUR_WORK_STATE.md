# XENIUR: strengthen the work

Implemented on 28 September 2026.

## The working experience

Home, setup, the project, object views, browsing, and the workflow library share Avenir, the original XR mark, brighter graphite surfaces, and lime accents. Three original illustrations connect the entry points: making, checking a basis, and finding sources. All figures are men with completely blank faces, following the latest requested art direction.

The project starts with a compact **Strengthen the work** strip. Open it to inspect recorded conditions, or select **Sharpen this** for the current work. Object views offer the same path. Neither opening a project nor completing a work step automatically starts an exercise.

The visual path is **Recall → Distinguish → Challenge → Apply**, followed by **Decide** for decisions. The active session replaces the expanded overview so the prompt stays visible. Pause and resume from the project; saved answers survive restarting the desktop app. A person can deliberately open the recorded basis during recall, or answer first and then compare:

- **You remembered**: their actual answer.
- **Recorded basis**: the rationale, other options, assumptions, and support facts captured when the session started.
- **What changed**: observed changes in the project's records, with the snapshot date.

There is no score, inferred understanding percentage, or XP.

## What Work State reads

`assessWorkState(graph, goalId)` is deterministic and local. The desktop adds its readiness evaluator to the same store.

| Recorded condition | Useful move |
| --- | --- |
| A citation or critique contradicts the basis | Compare the evidence |
| A citation has no human support review | Check the basis |
| A cited source has a newer stored copy | Review the change |
| A linked dependency or planned input changed | Revisit the dependent work |
| A decision is explicitly marked for review | Review the choice |
| A written assumption lacks a current explicit check | Test the assumption |
| A required output has no current form | Check requirements |
| A declared readiness profile is blocked or a recipe step is out of date | Address the actual blocker |
| A recorded choice is at least 30 days old | Recall why it was chosen |

Assessment includes the current goal and plan, project claims and decisions, support rows, dependency versions, constraints, declared readiness profiles, and the person's explicit check records. It excludes archived work and foreign project targets. Project-level claims and choices remain relevant even if the current focus is elsewhere.

A recent explicit assumption check is tied to the exact target version and a digest of its basis. It resurfaces after 30 days or when that basis changes. This records a person's check; it does not establish that the assumption is true. An intention to test does not count as a completed check.

## How answers improve the actual project

Every answer creates a normal Markdown note, links it to the reviewed object and version, and records a human process event. Available actions depend on the thinking move:

| Explicit action | Saved result |
| --- | --- |
| Save reflection | A linked note |
| Request review | A linked note, a review next action, and a review flag on an accepted decision |
| Find another source | A linked note and a source-finding next action |
| Add a test step | A linked note and a concrete next action |
| I checked this assumption | A linked note and a version-bound explicit check |
| Keep my choice | A linked reason for keeping it |

Keeping a choice cannot clear conflicting citations or changed-evidence alerts. The store never automatically reviews support, accepts a draft choice, approves a delivery, contacts someone, or runs a proposed test. External source-finding remains a task the person can undertake through the browser.

Answers are validated, ordered, and saved transactionally. Exact retries do not duplicate notes. Changed rationale, evidence, target versions, requirements, constraints, plan records, or relevant readiness invalidate an unfinished session before it writes. The person can start a fresh check from the updated basis.

## Illustrations and design research

The visual direction uses contextual scenes, flowing paths, limited colors, blank faces, and a consistent print texture. Images sit at entry points and in the optional overview. Short written labels remain alongside icons, so the illustration is never the only way to understand an action.

Contextual rather than excessive illustration follows [Atlassian's illustration guidance](https://atlassian.design/foundations/illustrations). Consistent colors and shapes, simplified visual aids, and HTML text follow the applicable image principles in the [GOV.UK Design System](https://design-system.service.gov.uk/styles/images/). The requested male-only art direction is a user preference, not a claim about who the product is for. Original scenes use XENIUR's identity; the provided reference was visual inspiration.

Assets and the generation prompts are in [the illustration directory](../brand/illustrations/README.md).

## Review the implementation

Use Node 22, then run `npm run preview:web`. Open:

- `http://localhost:5180/?visual-preview=home`
- `http://localhost:5180/?visual-preview=world`
- `http://localhost:5180/?visual-preview=firstrun`

The web preview runs the real renderer with explicitly selected sample data. Preview writes are in-memory demonstrations; keys are never accepted there. Desktop persistence and object effects are separately tested against the real SQLite graph.

Browser captures: [Home](screenshots/home.png), [setup](screenshots/models.png), [workflow library](screenshots/workflows.png), [web](screenshots/web.png), [browser](screenshots/browser.png), [project](screenshots/project.png), [Work State](screenshots/work-state.png), [recall](screenshots/sharpen-recall.png), [remembered versus recorded](screenshots/sharpen-record.png), [completed check](screenshots/sharpen-complete.png), and [compact layout](screenshots/sharpen-compact.png).

The browser walkthrough verifies all five moves, hidden recall basis, saved comparison, pause/resume, explicit source and test actions, completed path, first-run setup, and a 1024-pixel layout. It also exposed and led to fixing a circular process-record refresh in the project view.

Verification: TypeScript and the production desktop bundle pass. All 71 test suites passed across the broad run and separate Blender verification. The latest focused run passes all 21 Work State, Sharpen, and stylesheet checks, including persistence after reopening SQLite. Thirteen browser captures were taken; the five-move walkthrough reported no page errors. This is implementation verification with sample data, not recruited-user research.

The feature works without AI keys. Live Meshy/Runway generation, external recommendation services, community moderation infrastructure, and research with recruited users remain separate unfinished work from the earlier plan.
