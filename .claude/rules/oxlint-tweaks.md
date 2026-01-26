---
paths:
  - "**/.oxlintrc.json"
---

# Oxlint Manual Tweaks (SDK)

Oxlint configs for `packages/sdk` are regenerated from ESLint via `npx oxlint/migrate`.
When you regenerate `packages/sdk/.oxlintrc.json`, re-apply the manual tweaks
as listed below.

## Background

- This repo uses both ESLint and Oxlint.
- ESLint was the original linter; Oxlint was added later.
- `npx @oxlint/migrate` generates Oxlint config from `eslint.config.js`.
- The generated config does not fully match the original ESLint behavior.
- We apply manual tweaks after regeneration to preserve the intended linting behavior.
- Use the checklist below whenever `npx @oxlint/migrate` overwrites the config.

## Expected Manual Changes

- `no-unsafe-optional-chaining`: set to `off`
- `@typescript-eslint/ban-ts-comment`: allow `ts-ignore`/`ts-expect-error`
  with description using `"allow-with-description"` (not `descriptionFormat`);
  set `ts-check`/`ts-nocheck` to `"ban"`
- `jsdoc/check-tag-names`: add `definedTags: ["tailor-platform/sdk"]`
- remove `jsdoc/require-param`, `jsdoc/require-param-type`,
  `jsdoc/require-returns`, `jsdoc/require-returns-type`
- `import/no-cycle`: set to `"error"` (no options)
- remove `no-restricted-imports` overrides for:
  - `src/configure/**/*.ts`
  - `src/parser/**/*.ts`
- `src/parser/**/types.ts`: set `no-restricted-imports` to `off`
- `src/cli/**/*.ts`: remove restriction for `table`
- add `no-restricted-imports: off` override for
  `src/cli/utils/logger.ts` and `src/cli/utils/errors.ts`
