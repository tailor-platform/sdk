---
"@tailor-platform/sdk": minor
---

Add `--namespace` to `tailor query --engine sql` to run queries in a chosen TailorDB namespace instead of inferring it from the tables the query references. The namespace must be defined in the config, and in REPL mode it applies to every query in the session. The programmatic `query()` accepts the same `namespace` option.
