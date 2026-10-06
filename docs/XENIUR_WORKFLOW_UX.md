# Workflow audit and production-path improvements

4 October 2026

## What was reviewed

The Electron renderer, preload bridge, IPC handlers, journey engine, document exports, recipe workflows, source ingestion, source/privacy checks, price approval, decision records, browser entry, saved-record reader and test suite.

XENIUR already has two useful execution systems. Guided paths produce source-aware drafts and files through OpenRouter, with human acceptance between steps. Recipes transform files locally and track which outputs need rebuilding. Previously the library selected a recipe, created a project, then opened a generic path chooser. That lost the context of the original selection.

## Inspiration and boundaries

Primary sources inspected:

- [MoneyPrinterTurbo repository](https://github.com/harry0703/MoneyPrinterTurbo)
- [Project README](https://github.com/harry0703/MoneyPrinterTurbo/blob/main/README-en.md)
- [Main interface](https://github.com/harry0703/MoneyPrinterTurbo/blob/main/webui/Main.py)
- [Task orchestration](https://github.com/harry0703/MoneyPrinterTurbo/blob/main/app/services/task.py)

Its useful ideas are a concrete topic and custom script, ordered production stages, editable materials, stage-specific stopping points, previews and task progress. Its narration preview cache checks whether the script and settings still match; this is an especially useful principle for avoiding stale previews after an edit.

XENIUR adapts those ideas to its own work system. It does not install, execute or copy that project, add its sponsors or adopt its video providers. OpenRouter remains the AI connection. Video generation, speech synthesis, music licensing, publishing and generated 3D remain outside this release. Existing local processing of a person's own models remains available.

## Implemented

### Open the chosen work

- The library offers **Create something** and **Prepare files**.
- Choosing a built-in guided path creates the project and its journey in one database transaction, then opens its materials screen directly.
- Choosing a file recipe opens a dedicated workspace. The same routing works when reopening an existing recipe project.
- File workspaces provide native source selection, the actual source preview, local rebuilding, image result cards with Save, and visible validation results.
- Manual document recipes can enter the document path directly; advanced details have a return to the workflow.
- Project screens are keyed by project identity so switching projects does not reuse a previous project's local state.

### Start with the actual goal

A short saved brief captures topic, audience, language and optional instructions. Script briefs also capture duration and frame. The brief becomes the project goal and enters generation, source search, custom-path planning and export records. Editing it invalidates dependent work and marks earlier decisions for review. Credentials are rejected before persistence or model calls. Existing saved projects continue working without requiring migration.

### Make scripts visual

New script projects follow:

**Brief → direction → script → scenes → production plan → final check**

The storyboard has 2–12 ordered scenes with a title, visual direction, exact narration, source IDs and an estimated duration. A timing strip and frame previews make the sequence visible. Each scene can request a separately priced OpenRouter illustration using the existing XENIUR illustration style. Images remain optional concept art. The UI does not imply that filming or video rendering occurred.

Scene text and timing can be edited locally. Unchanged scenes retain their existing art; changing a scene removes its old art. Scene images are attached to actual versioned project objects, and accepted storyboard text and PNGs are included in the reviewed export package.

Older script projects retain their existing document route. Research reviews, real experiment reports and real prototype reports are preserved.

### Make review and return easier

- Earlier accepted stages open in a reading preview without changing approval or current progress.
- Reopening remains a separate action that invalidates dependent stages.
- Completed visual and code results have preview cards.
- Longer details and optional notes are collapsed until needed.
- Saved work-path records display their actual headings and content. Document outlines retain nested sections and tables.
- The path chooser describes the editing controls that actually exist.

## Verification

Backend checks cover brief invalidation, credential rejection, storyboard contracts and source scope, priced image approval, versioned scene storage, stale-art removal and export of the actual assets. Reading-view checks cover both work-path records and document outlines.

Browser checks exercise the preserved research journey, brand, marketing, scientific figure, coding and custom paths; direct library navigation; storyboard editing; accepted-result previews; final review; and compact layouts. Browser results use explicitly labelled sample fixtures.

The desktop check uses a disposable profile and real IPC, graph persistence, native file selection, local image processing and file saving. It makes no paid model calls and does not access the user's existing projects or keys.

The full automated suite passed 851 tests. Final focused checks passed 37 tests, and browser checks captured 41 screens without page errors. The desktop check persisted a real brief and saved a real 1024 × 1024 PNG after local processing.

Live OpenRouter generation still needs verification with a configured account. Script timing is an estimate. Source extraction and the existing bounded resource limits still apply. No user study is claimed.
