---
"@tailor-platform/sdk": minor
---

Add `auth` field to `createResolver` for declaring a resolver's access requirement, using the same `conditions`/`permit` notation as TailorDB's `.permission()` (restricted to `user` operands, e.g. `auth: { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }`). Rejects non-matching callers before `body` runs. `auth: "public"` explicitly documents that anonymous callers are allowed. Omitting `auth` keeps prior behavior unchanged.
