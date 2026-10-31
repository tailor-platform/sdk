---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: Declining the breaking-change confirmation for a namespace in `tailor tailordb migration generate` is no longer a failure. The command skips that namespace, still writes the others, exits 0, and ends with a `Skipped: <namespaces>` line. The JSON result gains a matching `skippedNamespaces` field, which stays empty because JSON output never prompts. Declining the `--init` confirmation still fails with `MIGRATION_GENERATE_CANCELLED`. `migrateGenerate()` now returns `Promise<MigrateGenerateResult>` instead of `Promise<void>` and resolves instead of rejecting when breaking changes are declined. Update explicit return-type annotations and check `result.skippedNamespaces` before continuing if your script must stop after a decline.
