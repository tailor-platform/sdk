---
"@tailor-platform/sdk": minor
---

`defineAuth` results now have `asExternal()`, which references an Auth service defined in another app of the same repository as an external one: `auth: coreAuth.asExternal()`. It takes over the name and the machine users, so the referencing app follows renames of both and gets the machine user names in its generated `tailor.d.ts`. A misspelled `invoker` there is then a type error, which `{ name: "...", external: true }` could not provide because it leaves the names empty. Hooks, OAuth2 clients, and the rest of the definition are not taken over, so the referencing app does not deploy them again.
