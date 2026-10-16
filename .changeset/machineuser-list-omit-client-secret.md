---
"@tailor-platform/sdk": minor
---

Remove `clientSecret` from the output of `tailor machineuser list` and from the `MachineUserInfo` returned by `listMachineUsers`. The Platform is moving to return a machine user's secret only from the single-user get call, so that a read-only credential can list machine users. Scripts that read `clientSecret` from the JSON output of `machineuser list` no longer find the key; use `tailor machineuser token <name>` to obtain an access token for a machine user instead.
