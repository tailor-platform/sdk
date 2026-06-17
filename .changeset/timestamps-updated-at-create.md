---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": major
---

Set `db.fields.timestamps()` `updatedAt` when records are created and make the generated field non-null. The helper now creates non-null `createdAt` and `updatedAt` fields with create hooks that preserve provided values and fall back to the current time.

Update create-sdk templates so scaffolded projects use the new non-null `updatedAt` Kysely types and seed schemas.

`updatedAt` no longer gets an update hook from the helper; define a custom `updatedAt` field if your schema should refresh it automatically on record updates.

Existing TailorDB schemas that already use this helper will change `updatedAt` from optional to required. Backfill existing records that have `updatedAt: null` before applying the schema change.
