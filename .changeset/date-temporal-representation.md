---
"@tailor-platform/sdk": minor
---

Add `t.date({ as: "temporal" })` so resolver input/output can work with `Temporal.PlainDate` instead of a `YYYY-MM-DD` string or a `Date`. Requires `compilerOptions.lib` to include `"ESNext"` (or `"ESNext.Temporal"`); with `skipLibCheck: false`, this applies to the whole project even without using `as: "temporal"`, because the SDK's own type declarations reference `Temporal` (see the resolver docs for details).
