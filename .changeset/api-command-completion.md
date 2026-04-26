---
"@tailor-platform/sdk": minor
---

`tailor-sdk api` ergonomics improvements:

- Shell completion now suggests `OperatorService` method names for the endpoint positional argument. Streaming RPCs are excluded since the command only handles unary requests.
- New `--field <key>=<value>` (alias `-f`) flag sets request fields one at a time. Supports dot-notation for nested messages (`tailordbType.name=User`) and repeats the same key to populate `repeated` scalar/enum fields. Values are coerced according to the proto field type, with range validation for 32/64-bit integers and `oneof` exclusivity at every nesting level. `map` fields, `repeated` of messages, and `google.protobuf.*` well-known types (Duration, Timestamp, FieldMask, …) require `--body`.
- New `--inspect` flag prints the input message tree of an endpoint without sending a request, including `oneof` membership, recursive type tagging, and `map` value schemas. Combine with `--json` for machine-readable output.
- New `--list` flag enumerates all invocable `OperatorService` methods.
- `--field` keys are completed dynamically from the proto descriptor of the chosen endpoint, including nested fields via dot-notation. Unassignable fields (map, repeated message, well-known types) are excluded from candidates.
