---
"@tailor-platform/sdk": minor
---

Add opt-in secure token storage via OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service). Set `TAILOR_USE_KEYRING=1` to enable. Default behavior remains unchanged (file-based V1 config) for backward compatibility with older SDK versions.
