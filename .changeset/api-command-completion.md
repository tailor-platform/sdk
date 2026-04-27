---
"@tailor-platform/sdk": minor
---

`tailor-sdk api` discoverability improvements:

- New `tailor-sdk api list` subcommand enumerates all invocable `OperatorService` methods. Streaming RPCs are excluded since the command only handles unary requests.
- New `tailor-sdk api inspect <endpoint>` subcommand prints the input message tree of an endpoint without sending a request, including `oneof` membership, recursive type tagging, and `map` value schemas. Combine with the global `--json` flag for machine-readable output.
- Shell completion now suggests `OperatorService` method names for the `endpoint` positional of `tailor-sdk api` and `tailor-sdk api inspect`.
