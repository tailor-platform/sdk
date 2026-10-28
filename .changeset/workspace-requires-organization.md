---
"@tailor-platform/sdk": major
---

`workspace create`, workspace creation during `deploy`, and the programmatic `createWorkspace()` now require an organization. Pass `--organization-id` (or set `TAILOR_PLATFORM_ORGANIZATION_ID`), or set a default organization with `tailor user update --default-organization-id`. Without one, the command fails before contacting the Platform instead of creating a workspace outside any organization.
