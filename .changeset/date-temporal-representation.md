---
"@tailor-platform/sdk": minor
---

Add `t.date({ as: "temporal" })` so resolver input/output can work with `Temporal.PlainDate` instead of a `YYYY-MM-DD` string or a `Date`. Using it requires `compilerOptions.lib` to include `"ESNext"` (or `"ESNext.Temporal"`), which in turn requires TypeScript 6.0 or later (see the resolver docs for details); projects that don't use `as: "temporal"` are unaffected.
