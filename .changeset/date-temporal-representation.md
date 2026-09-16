---
"@tailor-platform/sdk": minor
---

Add `as: "temporal"` to `t.date`, `t.datetime`, and `t.time`, using `Temporal.PlainDate`, `Temporal.Instant`, and `Temporal.PlainTime` respectively. Extend `as: "date"` to datetime and time fields, converting datetime input to a `Date` and time input to a `Date` on 1970-01-01 UTC. Time output uses hours/minutes (UTC for Date) and truncates seconds and fractions without rounding. Existing defaults remain unchanged. Temporal types require TypeScript 6.0+ with `"ESNext"` or `"ESNext.Temporal"` in `compilerOptions.lib`; projects that do not opt in are unaffected.
