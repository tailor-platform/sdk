---
"@tailor-platform/sdk": patch
---

Fix CLI auth config losing keyring-stored logins. Running any command without `TAILOR_USE_KEYRING` no longer downgrades `config.yaml` in a way that drops `storage: keyring` users (and dangles their `current_user` reference), which previously logged keyring users out. Configs containing keyring users now stay in V2 format; file-only configs still downgrade to V1 for backward compatibility.
