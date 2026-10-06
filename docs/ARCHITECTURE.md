# Architecture

XENIUR keeps the existing object graph and adds guided work paths on top. A project contains versioned objects, representations, source copies, claims, support assessments, decisions, plans, tasks, and receipts. The desktop renderer requests narrowly validated IPC operations; it has no Node access or provider keys.

## Boundaries

- **Renderer:** visual project paths, editors, source inspection, decisions, browser controls.
- **Main process:** local graph, resources, keys, tools, exports, OpenRouter requests, and task policy.
- **Graph:** SQLite state and a content-addressed blob store. Accepted decisions keep their recorded basis; changes can require review.
- **AI:** OpenRouter text and dedicated image endpoints. Models must have recent verified prices; an action reserves a spend allowance before dispatch. No generated video or 3D service is wired.
- **Browser:** sandboxed WebContentsViews with isolated sessions, navigation policy, public-address proxying, held downloads, and fixed read-only snapshot scripts. Web content has no renderer bridge. Saving a source is a human act and does not accept a claim.

The browser keeps a project's source shelf and can show two project tabs side by side. Capturing a selected passage stores that exact session copy. An explicit work-path option adopts the same source version without fetching again; adding it after later stages reopens dependent work. Comparison notes are human observations. Open tabs survive shutdown and restore only when requested, with no automatic background browsing. Held files remain available when a save dialog is cancelled, and changed bytes are refused before saving.

## Evidence retrieval

Resource ingestion reads all PDF pages up to explicit safety limits: 50 MB per resource, 2,000 PDF pages, 5 million extracted characters, and 128 resources per path. Up to 200 image-only pages receive bundled English OCR per import. Coverage records unreadable/skipped pages and partial captures. These are safety limits, not a promise of comprehensive literature coverage.

Immutable source versions are split into overlapping passages with page and character locators. A local SQLite FTS5 index ranks relevant passages from across the source, and includes positional anchors within a bounded model budget. Coverage shows captured pages and selected pages. An exact quoted citation must match a passage supplied to that request, source identity, version, and page. Matching establishes traceability, not entailment. A person's supports/uncertain/contradicts check creates a claim and human support records; source changes invalidate dependent work. Legacy drafts without passage citations remain readable and are labelled as having no linked passage.

## Recovery and outcomes

Guided AI requests have durable run records and cancellation signals. Interrupting a provider request does not guarantee the provider charged nothing. Reported charges are distinguished from unknown charges; after dispatch, unknown cost is conservatively accounted at the reserved maximum. On restart, unfinished runs become interrupted. Existing saved outputs remain available. Retrying a paid request is an explicit new action.

Project checks count locally observed evidence openings, reviews, reopened decisions, and exports. They are process observations, not cognitive scores or proof that decision quality improved. User research must evaluate usefulness, interruption, and return to work.

For the original graph's detailed design, see [graph architecture reference](XENIUR_M4_ARCHITECTURE.md). That milestone document is historical; this page describes the current desktop boundary.

SQLite 13 and Sharp use Node-API prebuilds. Startup scripts verify their bindings in Node or Electron directly, avoiding ABI switching and compiler-dependent rebuilds on supported package platforms.
