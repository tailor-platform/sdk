---
"@tailor-platform/sdk": minor
---

Add `hasAny` / `not hasAny` permission operators for array-to-array comparison

New permission operators that check whether two arrays share any common elements.

Usage examples:

- `[{ user: "roles" }, "hasAny", { record: "allowedRoles" }]` — allow access when the user's roles overlap with the record's allowed roles
- `[{ user: "tags" }, "not hasAny", ["blocked", "suspended"]]` — deny access when the user's tags share any element with the blocked list
- `[["admin", "editor"], "hasAny", { user: "roles" }]` — both operands can be string arrays

Unlike `in` / `not in` (scalar vs array), `hasAny` / `not hasAny` compares two arrays and checks for intersection.
