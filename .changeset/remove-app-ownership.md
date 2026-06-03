---
"@tailor-platform/sdk": patch
---

fix(cli): `remove` no longer deletes an application matched by name alone. Removal now verifies ownership via `sdk-app-id`/`sdk-name` labels (`isOwnedByApp`), consistent with every other resource type, so a same-named application owned by another user in a shared workspace is left untouched.
