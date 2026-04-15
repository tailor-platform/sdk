---
"@tailor-platform/sdk": patch
---

Fix `createTailorDBHook` to correctly handle `db.object({...}, { array: true })` fields. Previously, array values (and `null`/omitted values for optional array fields) were treated as a single nested object and processed recursively, corrupting the value and causing seed validation to fail with "Expected an array". Array elements are now recursed per element, and non-array values are passed through unchanged.
