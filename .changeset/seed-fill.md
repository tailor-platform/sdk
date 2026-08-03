---
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk": minor
---

Add `tailor seed fill` to write the values a record gets on create into JSONL seed data rows that are missing them. It fills `id` by default, so rows can reference each other by id, and `--fields` names any other create-time field to fill:

```bash
# ./seed/data/Customer.jsonl: {"name":"Acme Corporation"}
tailor seed fill
# ./seed/data/Customer.jsonl: {"id":"0b6b6f5e-...","name":"Acme Corporation"}

# also stamp a creation time on rows that have none
tailor seed fill --fields id,createdAt
```

Only the named fields are written: fields you did not name are not baked into the file, optional fields a line omits stay omitted, and lines keep the order the file lists them in. A rewritten file gets its keys ordered the way the type declares its fields, so a filled-in `id` lands at the front of the line. A field a type does not have is skipped for that type, so `--fields id` covers a whole data directory and leaves the IdP `_User` data alone. A field whose value comes from `id`, a field default, or a create hook that returns its input is only filled in where it is missing. The data is validated first and nothing is written when validation fails.

`tailor seed apply --upsert` now points at the command when a row has no `id`, since that is the run it blocks.

The same operation is available as `fillSeedData` from `@tailor-platform/sdk/seed`.
