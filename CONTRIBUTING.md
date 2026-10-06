# Contributing to XENIUR

Start with the [README](README.md), [architecture](docs/ARCHITECTURE.md), and [verification guide](docs/VERIFICATION.md).

## Development

Use Node 22 or newer. Run `npm ci`, `npm run dev`, then `npm run typecheck` and the tests relevant to your change. Run the full suite before a pull request that changes persistence, permissions, IPC contracts, source ingestion, or model transport.

Preserve existing work paths and saved projects. Use optional fields or migrations for persisted contracts. Never silently approve AI output, download a suggested resource, send private material, or change a paid step's price boundary.

## Small contributions

- Report a task you could not finish, with expected/actual behavior and your OS.
- Add a bounded work path to `packages/core/src/work-path.ts`; document its real inputs, outputs and limitations.
- Add a validator in `packages/validators` rather than marking generated work as verified.
- Improve keyboard navigation, source inspection or compact layouts.
- Add regression tests for a demonstrated failure.

## Pull requests

Describe the user problem, the change, verification, compatibility, and remaining limitations. Include screenshots for interface changes. Keep secrets, private resources, application-data folders, and generated dependency directories out of commits. Do not submit paid-model snapshots containing customer material.

Contributor interactions should be respectful and practical. Discuss evidence and implementations, not personal attributes. Report security issues through the private process in [SECURITY.md](SECURITY.md).
