# Installation

XENIUR is an early alpha. There is no claim of an already published, signed release. Use source builds today; the manual release workflow builds downloadable packages for maintainers to verify and sign.

## From source

Install Node.js 22.14 or newer, then run `nvm use 22`, `npm ci`, and `npm run dev` from the repository root. Windows users can use a Node.js installer or nvm-windows. The first screen connects one OpenRouter key, or offers local work without AI. Select models in Settings. Paid actions disclose what they send and show a maximum estimate.

## Desktop packages

`npm run package` builds the application and installers. macOS gets DMG/ZIP, Windows gets an NSIS installer, and Linux gets AppImage/deb. `npm run build && npm run package:dir` produces an unpacked application for smoke testing. GitHub's manual Release packages workflow produces artifacts without publishing them.

Signing requires maintainer certificates and credentials. Configure `CSC_LINK` and `CSC_KEY_PASSWORD` for code signing; macOS notarization additionally uses `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. Do not describe unsigned builds as signed. No automatic updater is shipped yet; updates require downloading a verified new package. Windows and Linux support requires the release checklist on those systems.

## Local tools

Documents always include an editable LaTeX source, bundled licensed fonts, and a self-contained printable HTML edition. The desktop app can export a PDF through its built-in print renderer when XeLaTeX is unavailable. XeLaTeX remains optional for the selected LaTeX layout. FFmpeg and Blender are needed only for their advanced local transformations. Executables are discovered on PATH; `XENIUR_FFMPEG`, `XENIUR_BLENDER`, and `XENIUR_XELATEX` override their location.

English OCR and its language data are bundled. They run locally. No OCR account or document upload is required. Other languages and complex equations still need inspection or a corrected text copy.

## Data and keys

For an isolated test installation, set `XENIUR_DATA_DIR` to a new absolute directory before launching. It overrides the application-data location; the default remains unchanged when it is unset.

Projects and preferences live in the operating system's Xeniur application-data directory. Preserve that directory before migrating between machines or testing an alpha build. API keys use Electron's OS secure storage. Linux's `basic_text` fallback is refused; use a supported Secret Service/keyring. Project exports do not include API keys or browser cookies. Browser profiles retain their own sign-in sessions; public browsing uses an ephemeral profile.
