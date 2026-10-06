# Security

XENIUR is an early-alpha desktop application. Use supported Electron releases and install dependency/security updates before public distribution.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** private reporting feature when enabled by the maintainer. Include the affected version, OS, reproduction, impact, and a minimal non-sensitive example. If private reporting is unavailable, ask the maintainer to enable it without posting exploit details or credentials publicly. No dedicated security email or response-time guarantee is currently established.

## Boundaries

- The main interface is sandboxed with context isolation and Node integration disabled.
- IPC validates the caller and request schema. Browser and code-preview contents do not receive application IPC privileges.
- API keys use operating-system encryption. Linux's plaintext `basic_text` fallback is refused.
- Source downloads validate public HTTPS destinations and redirects; browser cookies are not reused.
- Private/restricted sources are checked before remote processing. Paid steps require explicit bounded approval.
- AI sources, retrieved text, generated code and shared packages are untrusted input.
- Local OCR processes page images on the device. Cloud AI sends only the material disclosed in the step.

These boundaries do not constitute a completed penetration test or an assurance that generated claims or code are safe. Chromium browsing requires current runtime patches. Signing/notarization requires real maintainer credentials; unsigned alpha packages must be identified as unsigned.
