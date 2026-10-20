---
"@tailor-platform/sdk": minor
---

`tailor machineuser list` no longer outputs `clientSecret`, and `MachineUserInfo.clientSecret` returned by `listMachineUsers` is now an optional property that is never set and is marked `@deprecated`. The Platform is moving to return a machine user's secret only from the single-user get call, so that a read-only credential can list machine users. TypeScript code that reads `MachineUserInfo.clientSecret` keeps compiling but receives `undefined`; scripts that read `clientSecret` from the JSON output of `machineuser list` no longer find the key. Use `tailor machineuser token <name>` to obtain an access token for a machine user instead.
