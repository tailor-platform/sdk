---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": minor
---

Add `tailor seed backfill-ids` to backfill missing `id` values into existing JSONL seed files, backed by a new `backfillSeedIds` function in `@tailor-platform/sdk/seed`. Only the `id` field is written back: every other field keeps the value its line already had, so hook-computed values stay out of the files and omitted optional fields are not materialized as `null`. Rows that already have an `id` keep it, and files without an `id` field (such as `_User.jsonl`) are left untouched. Use it to prepare seed files that predate ids for `tailor seed apply --upsert`, which requires an `id` on every TailorDB row. The ids are newly generated and cannot match rows an earlier `apply` of the same files already created, so backfill before the data is first applied (or reseed with `apply --truncate`).
