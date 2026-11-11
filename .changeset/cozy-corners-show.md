---
"@tailor-platform/sdk": patch
---

A credential detected in `env` of `defineConfig` is now reported as an invalid config rather than an unexpected error. In `--json` output the error has `code: "CONFIG_INVALID"` instead of `UNEXPECTED_ERROR`, lists each offending key under `context.issues` (`path: ["env", "<KEY>"]`), and carries the fix, moving the value to Secret Manager or allowing it with `allowSecretReason`, in `suggestion` and the reason in `details` instead of in `message`. Plain output prints the same parts as `Error [CONFIG_INVALID]: tailor.config.ts: Invalid Tailor config:` followed by the issue list and `Details:` and `Suggestion:` lines. When `loadConfig` from `@tailor-platform/sdk/cli` throws this error, its `error.message` holds only the `Invalid Tailor config:` heading and the issue list.
