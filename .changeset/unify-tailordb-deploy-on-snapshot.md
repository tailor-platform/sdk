---
"@tailor-platform/sdk": patch
---

Unify the `tailor deploy` TailorDB pipeline on the snapshot schema. All plan and apply phases now consume the same canonical snapshot-shaped input that is also used by `tailordb migrate`, with decimal scale normalized to the platform default (`6`) at the snapshot boundary. This consolidates normalization in one place instead of relying on per-comparison workarounds (such as the decimal-scale fix in #1155) and prepares for a future `tailordb migration sync` command. No behavior change for SDK users.
