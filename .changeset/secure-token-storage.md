---
"@tailor-platform/sdk": minor
---

Store access tokens securely in the OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service) instead of plaintext in the config file. Existing V1 configs are automatically migrated to V2, and tokens are moved to the keyring on next login or token refresh. Falls back to file-based storage when keyring is unavailable.
