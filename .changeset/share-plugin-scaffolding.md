---
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Deduplicate the plugin CLI scaffolding (logger, shared arguments, `defineAppCommand`) into the internal `@tailor-platform/shared` package. No behavior change: `tailor seed` keeps its `-v` alias for `--verbose`, and `tailor tailordb erd` keeps `--verbose` without a short alias.
