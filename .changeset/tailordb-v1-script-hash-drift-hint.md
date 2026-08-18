---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": patch
---

Add a targeted hint to the `Remote schema drift detected` error when every reported drift is a missing script hash — the pattern left by an environment last deployed with the pre-v2 CLI, which never wrote script hashes. The hint points at `migration sync <N>`, which is already listed as one of the general resolution options. The v2 migration guide (`docs/migration/v2.md`) now also documents that the first `tailor deploy` against such an environment needs a `migration sync` first.
