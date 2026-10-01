---
"@tailor-platform/sdk": patch
---

Argument errors now follow `--json` and `TAILOR_JSON_OUTPUT`. An unknown option or subcommand, or an option value that fails validation, was printed as plain text even when JSON output was requested, because it happened before the flag took effect. It is now reported as the usual JSON error envelope on stderr with the code `INVALID_ARGUMENTS`, for example `{"error":{"code":"INVALID_ARGUMENTS","message":"Unknown flags: bogus"}}`. Output without JSON mode is unchanged.
