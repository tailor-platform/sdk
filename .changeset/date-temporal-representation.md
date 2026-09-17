---
"@tailor-platform/sdk": minor
---

Add `as: "temporal"` to `t.date`, `t.datetime`, and `t.time`, using `Temporal.PlainDate`, `Temporal.Instant`, and `Temporal.PlainTime` respectively. Extend `as: "date"` to datetime and time fields, converting datetime input to a `Date` and time input to a `Date` on 1970-01-01 UTC. Time output uses hours/minutes (UTC for Date) and truncates seconds and fractions without rounding. Existing defaults remain unchanged. Import `Temporal` from `@tailor-platform/sdk/runtime` for constructors and types without changing TypeScript `lib` settings. The `tailor-runtime` Vitest environment installs a Temporal polyfill only when the runtime lacks it; deployed functions use native Temporal.
