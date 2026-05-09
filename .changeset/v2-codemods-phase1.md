---
"@tailor-platform/sdk-codemod": minor
---

Add three v2 codemods that the upgrade runner can apply when migrating across the 1.x → 2.x boundary:

- `v2/test-run-arg-input` strips the deprecated `{ "input": ... }` wrapper from `tailor-sdk function test-run --arg` JSON inside `package.json` scripts, shell scripts, and Markdown code blocks.
- `v2/sdk-skills-shim` rewrites `tailor-sdk-skills` invocations to `tailor-sdk skills install` across `package.json`, shell, YAML, and Markdown files.
- `v2/principal-unify` renames `TailorUser` / `TailorActor` / `TailorInvoker` to the unified `TailorPrincipal`, drops `unauthenticatedTailorUser` (replacing standalone value references with `null`; member-access forms are left as-is so the resulting type error points authors at sites that need manual review), and renames `user` to `caller` inside `createResolver` body parameters and member accesses.
- `v2/apply-to-deploy` rewrites `tailor-sdk apply` invocations in `package.json` scripts, shell scripts, CI YAML, and Markdown to the v2-recommended `tailor-sdk deploy` alias. Optional `@version` pins (`tailor-sdk@latest`, `tailor-sdk@1.45.2`) are preserved.
- `v2/cli-rename` rewrites `tailor-sdk crash-report` invocations to the v2 single-word `tailor-sdk crashreport` form across `package.json` scripts, shell scripts, CI YAML, and Markdown. Optional `@version` pins are preserved.
