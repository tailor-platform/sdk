---
"@tailor-platform/sdk": patch
---

`tailor query --engine sql` now writes the row count of its text output to stderr as `ℹ rows: N`, in the REPL too, instead of `rows: N` on stdout, so piping the output captures only the result tables. `--json` output is unchanged; a script that needs the count can read `rowCount` there.
