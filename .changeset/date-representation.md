---
"@tailor-platform/sdk": minor
---

Add `t.date({ as: "date" })` to use JavaScript Date values in resolvers. Inputs become Dates at midnight UTC, and returned Dates are formatted as YYYY-MM-DD using their UTC calendar date, including nested objects, arrays, and optional fields. Existing `t.date()` fields continue to use strings.
