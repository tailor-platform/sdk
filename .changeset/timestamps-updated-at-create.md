---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": major
---

Set `db.fields.timestamps()` `updatedAt` when records are created and make the generated field non-null. `createdAt` keeps its existing create-time behavior, while `updatedAt` keeps its update-time behavior and now also gets a create hook that preserves provided values and falls back to the current time.

Update create-sdk templates so scaffolded projects use the new non-null `updatedAt` Kysely types and seed schemas.

Existing TailorDB schemas that already use this helper will change `updatedAt` from optional to required. Backfill existing records that have `updatedAt: null` before applying the schema change.
