---
"@tailor-platform/sdk": minor
---

Add `permission` field to `createResolver` for declaring a resolver's access requirement, using the same `conditions`/`permit` policy notation as TailorDB's `.permission()` (restricted to `user` operands, e.g. `permission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }]`). Rejects non-matching callers before `body` runs. Multiple policies combine like an allow-list with an explicit-deny override. `permission: "allowAnonymous"` explicitly documents that anonymous callers are allowed. Omitting `permission` keeps prior behavior unchanged. `tailor-sdk function test-run` enforces the same guard.
