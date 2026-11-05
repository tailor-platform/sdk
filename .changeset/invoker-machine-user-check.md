---
"@tailor-platform/sdk": minor
---

`tailor deploy` now stops with `INVOKER_MACHINE_USER_NOT_FOUND` when a string `invoker` of a resolver or an executor names a machine user that does not exist in its Auth service. Before, a misspelled name passed `tsc` and `deploy`, and failed with `machine user not found` when the resolver or executor first ran. The check accepts machine users that already exist in the workspace and machine users that configs deployed in the same run define, which covers an Auth service referenced as `external`. An existing config that names a machine user that exists nowhere now fails at deploy; add the machine user to the Auth service or fix the name.
