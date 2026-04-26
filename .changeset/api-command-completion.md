---
"@tailor-platform/sdk": minor
---

`tailor-sdk api` ergonomics improvements:

- Shell completion now suggests `OperatorService` method names for the endpoint positional argument.
- New `--field <key>=<value>` (alias `-f`) flag sets request fields one at a time. Supports dot-notation for nested messages (`tailordbType.name=User`) and repeats the same key to populate `repeated` fields. Values are coerced according to the proto field type. `map` fields and `repeated` of messages still require `--body`.
- New `--inspect` flag prints the input message tree of an endpoint without sending a request. Combine with `--json` for machine-readable output.
- New `--list` flag enumerates all available `OperatorService` methods.
- `--field` keys are completed dynamically from the proto descriptor of the chosen endpoint, including nested fields via dot-notation.
