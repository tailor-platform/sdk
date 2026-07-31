---
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk": patch
---

Generate the v2 migration guide (`packages/sdk/docs/migration/v2.md`) from the codemod registry, which is the single source of truth. Each entry renders its name, automation level (Automatic / Partially automatic / Manual), description, optional before/after `examples`, and — for changes the codemods cannot fully migrate on their own — the LLM/manual migration prompt. Run `pnpm codemod:docs:update` to regenerate and `pnpm codemod:docs:check` (wired into `pnpm check`) to verify it is in sync.

`scriptPath` is now optional, so the registry can also describe codemod-less ("manual") migrations that ship only guidance (`examples` / `prompt` / `suspiciousPatterns`) with no automatic transform. A manual entry with a `prompt` but no scoping pattern is surfaced as a project-wide `llmReviews` entry at runtime.

Add a `sdk-codemod list` command that prints every registered rule (id, name, kind, version range).
