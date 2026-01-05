---
"@tailor-platform/sdk": patch
---

fix(cli): unify table border style to single-line across all CLI commands

- Add `formatTable`, `formatKeyValueTable`, `formatTableWithHeaders` utility functions
- Add `formatValue` function for proper object/array formatting in tables
- Add ESLint rule to restrict direct `table` import
- Add tests for format utilities
