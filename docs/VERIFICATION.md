# Verification and release gates

## Automated

Use Node.js 22. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. CI installs Blender/FFmpeg test tools and repeats those on macOS, Windows and Linux (Windows excludes the Unix executable-fixture probe suite), and packages an unpacked desktop artifact. The manual release workflow builds installers. A workflow definition is not evidence that its runs or every operating system passed.

Focused coverage includes later-page retrieval, quote/source/version forgery rejection, text and scanned PDFs, OpenRouter contracts, price changes, invalid keys and rate-limit responses, stale project state, spend accounting, real graph decisions, human reasoning effects, browser policy, and local file exports. `scripts/check-workflow-desktop.mjs` exercises a disposable Electron profile with actual IPC, a local image transform, and file saving. Browser verification must exercise actual WebContentsViews as well as policy tests.

After building, run `npm run verify:workflow`, `npm run verify:browser`, and `npm run verify:export`. These use disposable profiles and make no paid AI calls. The browser check uses two clearly labelled local HTML fixtures behind an isolated HTTPS protocol handler; it validates real native views and project operations, not external website compatibility. Its comparison screenshot combines the shell and native-view captures because those are separate surfaces. The export check deliberately disables XeLaTeX and inspects the resulting real A4 PDF.

## Local results — 4 October 2026

On the current macOS/Apple Silicon machine with Node 22:

- Fresh `npm ci`, native binding checks in Node/Electron, type checking and production build passed.
- All 860 tests across 78 files passed, including a 120-page PDF and a scanned PDF with local OCR.
- Electron 44.5.1 desktop checks passed for direct workflow selection, a persisted brief, real source import, local image processing and a saved 1024×1024 PNG.
- Two native browser views passed comparison, exact selection capture into a work path, remote-bridge isolation, a saved human note, blocked localhost navigation, keyboard/find, fullscreen, resizing and return-to-work hiding. Cancelled file saving retained the download; modified bytes were rejected. Tabs survived restart and restored only on request.
- The built-in print renderer produced an A4 PDF without XeLaTeX, with escaped HTML, editable TeX, licensed fonts and evidence records in the ZIP.
- The unpacked, unsigned macOS application launched successfully and completed the workflow/file checks using its packaged dependencies.
- The original logo path animation was visually inspected. Reduced motion shows the finished mark without the reveal. The revised container has generous clear space around the logo.

These runs used local fixtures and existing local tools. They do not establish live model quality, signed installer distribution, clean-machine behavior, compatibility with all websites, Windows/Linux success or improved human decision quality.

## Live OpenRouter

`npm run verify:live` describes the test without calling AI. To run it, supply `XENIUR_LIVE_KEY`, `XENIUR_LIVE_MODEL`, and a positive `XENIUR_LIVE_MAX_USD` at most $10, then use `npm run verify:live -- --run`. An optional `XENIUR_LIVE_IMAGE_MODEL` enables one fixed-price drawing. The key is never printed or stored. The script uses a temporary project, a public CO2-electrolysis test topic, individually imports a search result, creates an overview, and saves a local report. Review the overview and drawing manually. Repeat with each supported release model.

Passing contracts does not prove search quality, successful imports from every publisher, factual quality, actual billing, or availability. No live run is claimed without its dated report. Test invalid credentials, insufficient credits, rate limiting, cancellation, and recovery with an isolated account; do not force-charge a personal account to manufacture failure cases. Compare provider-reported costs with account charges.

## Installer checklist

On clean machines for each supported OS: open the installer; launch offline; try local work; connect OpenRouter; finish a useful path; save a PDF without XeLaTeX; read a scanned PDF; reopen saved work; inspect evidence; cancel a request; verify recovery; browse, capture, compare, and return to the project; test keyboard controls and scaling. Verify package signatures/notarization separately. Publish only verified artifacts. An automatic update channel remains future work.

## Human usefulness

Recruit people who do not routinely use AI tools. Give them a real project and record task completion, time to a useful export, errors, clarity of approval consequences, and recovery. At consequential decisions compare source inspection and reasoning quality against baseline work. For discoveries at stopping points ask whether the discovery helped the task, interrupted work, and whether the person returned to work. Use voluntary feedback and local process records; avoid engagement scores or claims of measured understanding.

## Dependency audit

Run `npm audit` and `npm audit --omit=dev`. Audit findings in build tools require review too. Do not silently force a framework migration to satisfy the audit; document unresolved development-tool advisories and keep untrusted glob patterns away from those tools. No penetration-test or universal reliability claim is made.

The local production audit reported zero advisories. The full audit still reported five high-severity development dependency entries in the Tailwind 3 tool chain (braces/micromatch/glob callers). See the [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). A compatible update did not clear that chain; maintainers must resolve or assess it before release. Production-only auditing is not a complete security assessment.
