---
"@tailor-platform/create-sdk": patch
---

Fix the `hello-world` template docs so they match the tooling the template actually ships: the README now documents `oxfmt` / `oxlint` (instead of Prettier / ESLint) and the `generate` script, and the setup commands use `npx tailor <command>`. The unused empty `.prettierrc` is no longer generated.
