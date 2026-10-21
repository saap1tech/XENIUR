# XENIUR

A desktop workspace for turning sources and ideas into work you can use and explain.

Start a project, bring your material, and follow a visual path. Keep the evidence, choices, and reasons alongside what you make, so you can revisit them when something changes.

![XENIUR home, continuing a real project](docs/screenshots/live/home.png)

## What it does

- Research reviews and reports of real experiments or prototypes.
- Brand directions, scientific figures, marketing plans, and product listings.
- Scripts, illustrated storyboards, and small web projects.
- Project browsing: compare pages, keep sources, and return to your work.
- Evidence inspection and short thinking checks at useful stopping points.

Your projects stay on your computer. AI steps use **one OpenRouter key** for text and images, and show an estimate before running. You can also work with local files without AI.

## A real project, start to finish

Every picture below is from one real project run with an OpenRouter key: *"How much do green roofs cool cities in summer?"*. Nothing is staged. The whole project, from search to the finished document, cost under **$0.05** in AI calls.

| | |
|---|---|
| ![Sources found by a web search, each with a link and a reason](docs/screenshots/live/sources.png) | ![The cost of a step, shown before it runs](docs/screenshots/live/cost.png) |
| **Find sources.** One search returns real papers. You keep the ones you trust; nothing is downloaded until you choose. | **See the price first.** Every AI step shows its maximum cost, what is sent, and to whom, before it runs. |
| ![An overview where every finding links to its source passage](docs/screenshots/live/overview.png) | ![A full draft, styled with your choices, ready for your review](docs/screenshots/live/draft.png) |
| **Understand.** A one-page overview where every finding links to the exact passage it rests on. | **Make and review.** A styled draft you edit and check yourself, then save as PDF, HTML and editable LaTeX. |
| ![Ready-made paths to start a project](docs/screenshots/live/workflows.png) | ![Projects on the home screen](docs/screenshots/live/projects.png) |
| **Start from a path.** Research, reports, figures, briefs, and more; or describe your own. | **Pick up where you left off.** Projects keep their sources, choices and reasons. |

## Run it

Install Node.js 22, then:

```sh
git clone https://github.com/saap1tech/XENIUR.git
cd XENIUR
nvm use 22
npm ci
npm run dev
```

[Installation and desktop packages](docs/INSTALLATION.md) · [Documentation](docs/README.md)

## Current status

**Early alpha.** Review AI drafts and citations before using them. Video generation and generated 3D are planned for later. Signed releases, live-model verification, and testing on clean Windows/Linux machines still need completion.

## Contribute

Try a real task and tell us where you got stuck. Fixes, useful workflows, accessibility work, and tests are welcome. See [contributing](CONTRIBUTING.md) and [security](SECURITY.md).

[MIT license](LICENSE). Bundled fonts and dependencies keep their [own licenses](THIRD_PARTY_NOTICES.md).
