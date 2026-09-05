---
"@tailor-platform/create-sdk": patch
---

Fix the same stale-tooling docs issue across the remaining `create-sdk` templates (executor, inventory-management, multi-application, resolver, static-web-site, tailordb, workflow): remove the unused empty `.prettierrc` files, and update the `inventory-management` / `multi-application` READMEs' Scripts sections to document `oxfmt` / `oxlint` (instead of Prettier / ESLint), matching the tooling their `package.json` actually ships. The `inventory-management` README's Scripts section also referenced a nonexistent `gen` script; it now documents the actual `generate` script.
