# XENIUR: a visual path through real work

Implementation update, 28 September 2026. This supersedes the older multi-provider setup described in earlier design notes.

## What changed

The default project screen is now a guided workspace. It shows one step and its main actions, with short icon labels. The existing full workbench, decision records and Sharpen tools remain under **Details**. Home, setup, projects, reading, workflows, source capture and browsing share the original XR mark, Avenir typography, forest graphite surfaces and lime accents. Document pages use light paper surfaces.

The flow is **Materials → Understand → Structure → Colors → Type → Layout → Make → Review**. Human approvals create real decision records. The eight stages also update the existing goal plan; changing materials or earlier choices marks dependent work for review. Generating content never certifies its truth.

This follows [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): show the task first and reveal supporting detail when requested. Icons retain short labels, accessible names and keyboard focus indicators. Sparse text is an interface choice; source material and editable documents retain their substantive content.

## One connection

The first-run screen accepts one **OpenRouter** key. Settings supports replacement, removal, connection checks, model selection, and per-step/monthly spend limits. Local work remains available without a key. Setup returns on a later launch if no verified, selected language model is available.

The main process encrypts the key using the existing OS-backed store. The renderer receives availability and model metadata, never the stored key. Verification checks the authenticated key endpoint and the user's filtered model catalogue. Prices and IDs come from discovery; the application does not invent Luna/Terra/Sol API model IDs.

Text uses `/chat/completions`; source search uses the bounded Exa server tool and only returned HTTPS citation annotations become source suggestions. Images use the dedicated `/images` API. Image discovery reads each endpoint's pricing and capabilities, accepts fixed per-image prices, pins the provider, refreshes the endpoint before generation, and refuses a price rise until reviewed again. Unsupported or variably priced image routes are not offered. Returned raster bytes are decoded and normalized locally; active SVG is refused.

Every paid guided step shows its estimated ceiling and what is sent. Text estimates include conservative framing; search also includes a second model pass, bounded excerpts and the search charge. Router token price ceilings and disabled fallback restrict routing. Reported cost is recorded; when unavailable, the approved ceiling is used conservatively. A request that fails before generation dispatch releases its hold. These are application accounting controls, not an OpenRouter account-level billing guarantee.

Primary references: [key verification](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key), [user-filtered models](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails), [server search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [Image API and endpoint pricing](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

## Source-to-document path

1. **Materials:** upload readable files, add notes or links, use an existing project file, or ask for sources. Search presents each candidate separately. **Add** downloads that candidate and records the choice; **Skip** records rejection without downloading. Removing a resource from this path preserves its original project record.
2. **Understand:** create a short, source-linked overview on a paper surface. Generate an optional conceptual topic illustration with the XENIUR illustration style. Keep missing evidence visible. Allow three focused report revisions before returning to material or starting a fresh summary.
3. **Structure:** preview sections, subsections and subsubsections. Request additions, moves or removals, then explicitly approve the structure.
4. **Colors:** choose from topic-related palettes proposed by the model, previewed as swatches and a small paper card.
5. **Type:** choose from four bundled, licensed fonts. The cards show actual typeset specimens, not generated pictures of supposed fonts.
6. **Layout:** choose one of four controlled LaTeX templates. The cards are images of genuinely compiled sample pages.
7. **Make:** generate a structured draft from the approved outline and captured excerpts. Validate cited source IDs and table shapes. Ask for conceptual figure ideas and source PDF page suggestions without guessing unavailable page locations.
8. **Review:** directly edit section paragraphs. Inspect the sources. Select a PDF page and crop a real source figure after confirming permission; or generate a conceptual figure with OpenRouter. Record the human review of claims, citations, tables, figures and uncertainty before saving.

Export creates an editable ZIP containing `main.tex`, font files and licenses, actual image files, and the project record. A working host XeLaTeX can add the compiled PDF. If compilation is unavailable, the editable bundle remains usable and the interface states the limitation. Content is escaped into controlled templates; models cannot submit arbitrary executable TeX. The interface paper preview reflows for reading; the export is typeset on A4.

Fonts are Cochineal, Erewhon, TeX Gyre Pagella and TeX Gyre Schola. Templates are Field notes, Journal, Atlas and Essay. Curated real choices reduce selection overhead; this version does not automatically search for and execute third-party templates. Specimens are regenerated by `scripts/render-document-previews.ts` using the same document renderer. See [TUG's font catalogue](https://tug.org/FontCatalogue/cochineal/) and the included licenses.

## Scope and evidence limits

The same reviewed path serves research reviews, written pieces, lessons, campaign briefs, practical plans and software briefs through different drafting instructions. It does not execute an entire marketing campaign or produce and test executable software.

Sources are versioned and linked to generated artifacts. Private, restricted, archived, changed-source and local-only work states block remote processing. Imported PDF reading uses [PDF.js](https://mozilla.github.io/pdf.js/examples/). Downloads use checked public destinations; sources are data, not instructions for the assistant.

This version supports 16 resources per path, 25 MB files, PDFs up to 500 pages, extraction from at most the first 100 pages, and 300,000 extracted characters. Model input gives every resource a bounded excerpt share, with a 65,000-character total and 18,000-character per-resource maximum. Partial coverage is recorded. There is no OCR for scanned PDFs. These limits prevent a short draft from being misrepresented as an exhaustive literature review.

Generated topic pictures are explicitly conceptual. They do not represent measured results. Source figure reuse requires human permission confirmation. AI writing is a draft for revision; prompting cannot guarantee human authorship, originality or scientific correctness.

## Browsing as a workspace

**Explore opens the browser directly at full workspace size.** The tab strip sits above familiar back/forward/reload controls and a wide address field. The new-tab page has a contextual exploration illustration and one search field. The project panel is optional. **Saved sources** opens the source collection; project browsing retains the explicit Save to project action.

A default public reading session makes browsing available immediately. Separate profiles can be added for signed-in sites without changing the session of an existing tab. Desktop full-screen mode is available from the browser toolbar. Cmd/Ctrl+L, T, W, R and F work in the browser; child web pages forward the fixed shortcut commands to the application. Ctrl/Cmd+Tab switches tabs while a web page has focus. Escape exits full-screen mode. Web views are resized to the browser pane, hidden for the source-saving dialog, and hidden when returning to work. Separate sessions, held downloads, human takeover, public-address checks and existing browser protections remain in effect.

## Illustration system

Six original assets now serve different moments: workshop, strengthening the basis, research, gathering materials, open exploration and finishing work. The three new scenes retain cream limestone, olive/sage, muted coastal blue, forest graphite and a lime route. People are men with blank faces, or masculine hands without faces. Pictures carry no interface labels. See `brand/illustrations/README.md` for direction and placements.

## Progress and discoveries

**Predictable progress with occasional project-relevant discoveries at stopping points.** The guided view offers a discovery only after the person's overview approval, outline approval or final review. It uses the existing project-matching rhythm service, rate limits and optional preference. **Explore** or **Later** resolves an offer; there is no forced viewing, score or reward for accepting AI output. This is not an inference about the person's mental state.

Existing Work State and Sharpen remain available. They report observable missing checks, changed inputs and dependencies, and write human thinking moves back to real work objects.

## Verification and remaining work

**Final checks:** TypeScript checking and the desktop production bundle passed. All 836 tests across 74 files passed. The sample browser walkthrough captured 20 screens with no browser errors. An isolated native desktop check verified direct Explore navigation, full-screen entry/exit, a 1360 × 721 web pane and hiding the web view after returning home.

The automated backend checks cover persistence, individual source decisions, stale versions, citation validation, privacy, edit limits, image provider/price refresh, real raster storage, accounting, TeX escaping, real PDF compilation, PDF extraction and source cropping. The browser walkthrough traverses all eight stages, edits material, rejects and accepts separate source suggestions, saves a human review and checks smaller layouts. Preview research and images are explicitly sample data; they are not live scientific findings.

Run the sample walkthrough after starting `npm run preview:web`: `node scripts/check-guided-ui.mjs` (Node 22; the script uses installed macOS Chrome). Screenshots are in `docs/screenshots/`.

Live OpenRouter generation still needs a user-supplied key for account-specific end-to-end verification. Video and 3D generation are deferred. Existing signed challenge feeds are not a centrally moderated community. External opportunity discovery and real-user usability testing remain future work.
