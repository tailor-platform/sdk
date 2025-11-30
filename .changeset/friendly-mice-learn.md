---
"@tailor-platform/sdk": minor
---

Improve seed generator with Windows compatibility and IdP user support

- Generate `exec.mjs` instead of `exec.sh` for cross-platform compatibility
- Add IdP user seed generation (`_User` entity) when `BuiltInIdP` is configured
  - Generates `_User.schema.ts`, `_User.graphql`, `_User.json` mapping files
  - Includes foreign key to user profile type and unique index on `name` field
  - Automatically sets dependency order (User → \_User)
