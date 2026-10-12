# UI verification captures

## `live/`: a real, paid run

The images in `live/` come from the actual desktop build in a throwaway profile, connected to OpenRouter with a real key on 11 October 2026. The project is *"How much do green roofs cool cities in summer?"*. The search, imported source, overview, illustration, outline and draft are real model output; the source is the open-access paper the search returned. The search, overview and outline used `openai/gpt-4o-mini`, the draft used `qwen/qwen3-235b-a22b-2507`, and the illustration used `bytedance-seed/seedream-5-0-flash`. Provider-reported charges for the successful steps came to about $0.035 (search $0.008, overview $0.002, illustration $0.018, outline $0.001, draft $0.004). Claims in the draft were not independently fact-checked for these captures.

## Sample-data captures

The `guided-*`, `home-simplified`, `openrouter-setup`, `browser-simplified`, `web-simplified` and `workflows-simplified` images show the real renderer using clearly identified local sample data. No real scientific search or paid generation is represented by these samples. The complete sample journey is checked by `scripts/check-guided-ui.mjs`.

`browser-desktop-chrome.png` is the trusted renderer from an isolated native desktop run. Electron renders external web content in a separate WebContentsView, which the renderer screenshot does not capture. The native check independently verified the loaded Example Domain tab's web view dimensions and that it becomes zero-sized after returning home.

The guide includes the actual behavior and remaining account-specific checks: `../XENIUR_GUIDED_WORK.md`.
