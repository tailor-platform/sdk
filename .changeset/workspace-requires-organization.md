---
"@tailor-platform/sdk": major
---

`workspace create`, workspace creation during `deploy`, and the programmatic `createWorkspace()` now require an organization. Pass `--organization-id` (or set `TAILOR_PLATFORM_ORGANIZATION_ID`), or set a default organization with `tailor user update --default-organization-id` (not read while `TAILOR_PLATFORM_TOKEN` or `TAILOR_TOKEN` is set). Without one, interactive `deploy` asks which organization to create the workspace in; `workspace create`, `createWorkspace()`, and non-interactive `deploy` fail instead of creating a workspace outside any organization.
