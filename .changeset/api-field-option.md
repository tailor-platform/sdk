---
"@tailor-platform/sdk": minor
---

Add `--field key=value` (`-f`) to `tailor-sdk api <endpoint>` for setting request-body fields without writing JSON. Dotted keys build nested objects (`-f application.name=foo`), `--field` overrides matching keys in `--body`, and field names tab-complete from the endpoint's proto schema (bash / zsh / fish) — including step-by-step completion of nested message fields.
