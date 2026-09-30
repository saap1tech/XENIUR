# UI verification captures

The `guided-*`, `home-simplified`, `openrouter-setup`, `browser-simplified`, `web-simplified` and `workflows-simplified` images show the real renderer using clearly identified local sample data. No real scientific search or paid generation is represented by these samples. The complete sample journey is checked by `scripts/check-guided-ui.mjs`.

`browser-desktop-chrome.png` is the trusted renderer from an isolated native desktop run. Electron renders external web content in a separate WebContentsView, which the renderer screenshot does not capture. The native check independently verified the loaded Example Domain tab's web view dimensions and that it becomes zero-sized after returning home.

The guide includes the actual behavior and remaining account-specific checks: `../XENIUR_GUIDED_WORK.md`.
