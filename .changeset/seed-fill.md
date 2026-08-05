---
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk": minor
"@tailor-platform/create-sdk": minor
---

Add `tailor seed fill` to fill in the values a record gets on create for the JSONL seed data rows that are missing them. It fills `id` by default, so rows can reference each other by id, and `--fields` names any other create-time field:

```bash
# ./seed/data/Customer.jsonl: {"name":"Acme Corporation"}
tailor seed fill
# ./seed/data/Customer.jsonl: {"id":"0b6b6f5e-...","name":"Acme Corporation"}

# also stamp a creation time on rows that have none
tailor seed fill --fields id,createdAt
```

The values come from the type itself — its `id`, its field defaults, its create hooks — applied to each row on its own. Nothing is validated, so a row can be filled while a required field is still missing or while another file references an id that does not exist yet; that is the point, since the ids are what you need in order to write the rows that reference them. Run `tailor seed validate` when the data is ready.

Only the named fields are written, and only into a row that has no value for them, so a value already in the file is never replaced. A line that gains nothing is left byte for byte as it was; a line that takes a value is written with its keys in the order the type declares its fields, so a filled-in `id` lands at the front. A field the type gives no value to is skipped, so `--fields id` covers a whole data directory and leaves the IdP `_User` data alone, and naming a field the platform assigns — a `serial` field, for instance — fills nothing and says so.

`tailor seed apply --upsert` now points at the command when a row has no `id`, since that is the run it blocks, and newly scaffolded projects get a `seed:fill` script next to `seed:validate`.

The generated seed schema files now export the type's create hook, which is where the values come from. Run `tailor generate` after upgrading; until then `tailor seed fill` reports which file needs regenerating.

`createTailorDBHook` from `@tailor-platform/sdk/test` takes a `validate` option, so it can compute the create-time values of a record that is not complete yet instead of throwing on the type's own `validate`.

The same operation is available as `fillSeedData` from `@tailor-platform/sdk/seed`.
