---
"@tailor-platform/sdk": minor
---

Add an `--upsert` flag to seed. Without it, seeding a workspace that already holds some of the rows fails the whole batch for that type on the first duplicate id and inserts nothing, so there is no way to add only the new rows to an already-seeded workspace. With `--upsert`, existing rows are updated instead of aborting the batch, and Built-In IdP users that already exist are updated rather than reported as failures. Default behavior is unchanged.
