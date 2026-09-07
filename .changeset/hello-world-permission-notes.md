---
"@tailor-platform/create-sdk": patch
---

Document why the `hello-world` template ships with fully open permissions: `src/db/user.ts` now explains that the template defines no auth and that production projects should define conditions in `.permission()` / `.gqlPermission()`, and the README gained a Security section listing the open `unsafeAllowAll*Permission` grants and the `allowAnonymous` resolver default that must be replaced before real use.
