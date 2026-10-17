---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk-plugin-setup": minor
---

The password of IdP users (`_User`) can now come from the `SEED_USER_PASSWORD` environment variable. A `_User` row without a `password` gets it from the variable: a plain string is used for every such user, and a JSON object such as `{"alice@example.com":"..."}` sets it per user name. A password written in `_User.jsonl` is kept, and with `--upsert` the variable only sets the password of users that do not exist yet. `tailor seed validate` and `tailor seed apply` both apply it, and the generated `_User.schema.ts` calls it from its `hook`, so run `tailor generate` to update existing projects. The workflows `tailor setup ci` generates pass the `SEED_USER_PASSWORD` secret to the seed steps; run `tailor setup update` to regenerate them.
