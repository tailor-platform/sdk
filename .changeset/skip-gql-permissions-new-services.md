---
"@tailor-platform/sdk": patch
---

fix: skip listTailorDBGQLPermissions API call for newly created services

When creating a new TailorDB service (namespace), the SDK was attempting to list existing gqlPermissions for the namespace before it was created, causing a "record not found" error. This fix skips the API call for newly created services since they don't have any existing gqlPermissions.
