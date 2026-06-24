---
"@tailor-platform/sdk": patch
---

refactor: migrate internal path aliases to Node subpath imports

Replace the tsconfig `@/*` path alias with the `#/*` subpath import
(`package.json` `imports`), and resolve `@tailor-platform/tailor-proto` as a
regular package dependency instead of a `@tailor-proto/*` path alias. Internal
build/resolution change only — no public API or runtime behavior change.
