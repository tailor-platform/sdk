---
"@tailor-platform/sdk": patch
---

Keep settings that a newer SDK version wrote to the CLI config file (`~/.config/tailor-platform/config.yaml`) when this version rewrites the file, for example after logging in or refreshing a token, instead of silently dropping them.
