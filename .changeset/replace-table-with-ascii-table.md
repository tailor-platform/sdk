---
"@tailor-platform/sdk": patch
---

Replaced the `table` dependency (heavy transitive deps, low OpenSSF Scorecard) with an in-house single-line box-drawing table renderer used by the CLI's tabular output (`logger.out`, `formatTable`/`formatKeyValueTable`/`formatTableWithHeaders`). Column width calculation now uses the small, dependency-free `get-east-asian-width` package for correct alignment with full-width (CJK) characters. No user-facing behavior change is expected.
