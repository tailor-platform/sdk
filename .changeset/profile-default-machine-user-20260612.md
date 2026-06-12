---
"@tailor-platform/sdk": minor
---

Add default machine user to CLI profiles. Use `tailor-sdk profile create <name> --machine-user <name>` or `tailor-sdk profile update <name> --machine-user <name>` to store a default machine user on a profile. Commands that require a machine user (`query`, `workflow start`, `function test-run`, `machineuser token`) now fall back to the active profile's default when no machine user is given via the command line (`--machine-user`, or the `NAME` argument for `machineuser token`) or the `TAILOR_PLATFORM_MACHINE_USER_NAME` environment variable. Pass an empty string to `profile update --machine-user ""` to clear the stored default.
