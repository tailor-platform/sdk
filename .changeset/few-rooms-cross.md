---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
---

A service `files` pattern ending in `.test.ts` or `.spec.ts` now includes test files when it comes after the other patterns, so including them no longer needs the deprecated `ignores: []`. Test files stay excluded by default, as if `"!**/*.test.ts"` and `"!**/*.spec.ts"` followed the last pattern that does not end in `.test.ts` or `.spec.ts`. A config that already lists such a pattern after its other patterns now loads the files it matches; remove the pattern to keep them excluded. The v3 codemod writes the two `!` patterns at that position.
