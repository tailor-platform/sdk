---
"@tailor-platform/sdk": minor
---

Add `tailor user update --default-organization-id <id> [--default-folder-id <id>]` to store where `tailor workspace create` puts new workspaces when neither `--organization-id` nor `--folder-id` is given. The defaults are kept per user and platform, and any explicit organization or folder, including through `TAILOR_PLATFORM_ORGANIZATION_ID` / `TAILOR_PLATFORM_FOLDER_ID`, replaces both. `workspace create` also now honors those environment variables when they come from `--env-file`, and it, `deploy --create-workspace`, and the programmatic `createWorkspace()` reject a folder ID without an organization ID with a clear error instead of failing with an internal error.
