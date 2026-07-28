---
"@tailor-platform/sdk": minor
---

Add an `--upsert` flag to seed. Without it, seeding a workspace that already holds some of the rows fails the whole batch for that type on the first duplicate id and inserts nothing. With `--upsert`, every TailorDB row must include an `id`; rows with new ids are inserted, rows with existing ids are updated, and omitted optional fields keep their stored values. Built-In IdP users are created or updated by name, with separate counts for each result. Default behavior is unchanged.
