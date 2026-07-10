---
"@tailor-platform/sdk": minor
---

Add `auth` field to `createResolver` for declaring a resolver's access requirement. Set `auth: "loggedIn"` to reject anonymous callers before `body` runs, or `auth: "public"` to explicitly document that anonymous callers are allowed. Omitting `auth` keeps prior behavior unchanged.
