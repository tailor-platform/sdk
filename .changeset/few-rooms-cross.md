---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
---

**Breaking change**: A service `files` pattern ending in `.test.ts` or `.spec.ts` now includes the test files it matches, wherever it sits in `files`, so including them no longer needs the deprecated `ignores: []`. Test files stay excluded by default: a pattern that does not end in `.test.ts` or `.spec.ts` matches no test files. A config without `ignores` that already lists a pattern ending in `.test.ts` or `.spec.ts` now loads the files it matches, and the next `tailor deploy` deploys them; remove the pattern to keep them excluded. The v3 codemod writes `!**/*.test.ts` and `!**/*.spec.ts` after the last pattern that neither starts with `!` nor ends in `.test.ts` or `.spec.ts`, and flags a pattern ending in `.test.ts` or `.spec.ts` placed before that point for a manual migration.
