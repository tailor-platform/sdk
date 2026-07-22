---
"@tailor-platform/sdk": minor
---

Add `permission` field to `createResolver` for declaring a resolver's access requirement, using the same `conditions`/`permit` policy notation as TailorDB's `.permission()` (restricted to `user` operands, e.g. `permission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }]`). Rejects non-matching callers before `body` runs. At least one `permit: true` policy is required (deny by default, granted only by a match); a matching `permit: false` policy always overrides that grant, for carving out an explicit exception. `permission: "allowAnonymous"` explicitly documents that anonymous callers are allowed. Omitting `permission` keeps prior behavior unchanged. `tailor-sdk function test-run` enforces the same guard.
