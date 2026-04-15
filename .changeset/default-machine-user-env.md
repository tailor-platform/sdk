---
"@tailor-platform/sdk": minor
---

Unify machine-user CLI flag naming and add `TAILOR_PLATFORM_MACHINE_USER_NAME` env variable

- Add `--machine-user` flag to `query`, `workflow start`, and `login` to align with `function test-run` and the rest of the CLI's kebab-case convention. The previous `--machineuser` flag continues to work as a hidden alias.
- Add `TAILOR_PLATFORM_MACHINE_USER_NAME` environment variable as a default machine user name for `query`, `workflow start`, and `function test-run`.
