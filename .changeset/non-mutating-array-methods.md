---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": patch
---

Internal refactoring: replace mutating array methods (`sort`/`reverse`/`splice`) with non-mutating ES2023 equivalents (`toSorted`/`toReversed`/`toSpliced`). No user-facing behavior change.
