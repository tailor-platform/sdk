---
"@tailor-platform/sdk": minor
---

`tailor deploy` now stops with `INVOKER_MACHINE_USER_NOT_FOUND` when a string `invoker` of a resolver or an executor names a machine user that does not exist in its Auth service. Before, a misspelled name passed `tsc` and `deploy`, and failed with `machine user not found` when the resolver or executor first ran. When a config deployed in the same run defines the Auth service, the machine users it lists are the ones accepted, because deploy removes the ones it no longer lists. When the Auth service is only referenced as `external`, the machine users that exist in the workspace are accepted. An existing config that names a machine user that exists nowhere now fails at deploy; add the machine user to the Auth service or fix the name. If you create the machine user of an externally referenced Auth service after deploying the app that uses it, deploy the Auth service first, or deploy both configs in the same run (`tailor deploy --config a,b`).
