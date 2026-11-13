---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
---

**Breaking change**: A service `files` pattern ending in `.test.ts` or `.spec.ts` now includes test files when it comes after the other patterns, so including them no longer needs the deprecated `ignores: []`. Test files stay excluded by default, as if `"!**/*.test.ts"` and `"!**/*.spec.ts"` followed the last pattern that neither starts with `!` nor ends in `.test.ts` or `.spec.ts`. A config without `ignores` that already lists such a pattern after its other patterns now loads the files it matches, and the next `tailor deploy` deploys them; remove the pattern to keep them excluded. The v3 codemod writes the two `!` patterns at that position.
