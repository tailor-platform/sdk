---
"@tailor-platform/sdk": minor
---

Add `--readonly` flag to `profile create` and `profile update` so editor users can use a viewer-style profile by default. Read-only profiles block every mutating command (`apply`, `remove`, `workspace create/delete/restore`, `secret create/update/delete`, `tailordb truncate`, `workflow start/resume`, `executor trigger`, `staticwebsite deploy`, `authconnection authorize/revoke`, `function test-run`, direct `api <endpoint>` calls, and `query` execution, etc.) with a `PROFILE_READONLY` error. Switch profile or run `profile update <name> --no-readonly` to lift the restriction. Profile management itself stays available so the flag can always be cleared. `profile update` skips remote user / workspace validation when only `--readonly` / `--no-readonly` is changing, so the flag can be cleared offline or with an expired token.

The guard activates only when a profile is in scope: pass `--profile <name>` or set `TAILOR_PLATFORM_PROFILE`. `TAILOR_PLATFORM_TOKEN` and `--workspace-id` direct access bypass the guard by design — they are intended for machine-user / CI flows where the platform token already encodes the permitted scope.
