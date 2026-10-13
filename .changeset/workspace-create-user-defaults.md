---
"@tailor-platform/sdk": minor
---

Add `tailor user update --default-organization-id <id> [--default-folder-id <id>]` to store where `tailor workspace create` puts new workspaces when neither `--organization-id` nor `--folder-id` is given. The defaults are kept per user and platform, and any explicit organization or folder, including through `TAILOR_PLATFORM_ORGANIZATION_ID` / `TAILOR_PLATFORM_FOLDER_ID`, replaces both. `workspace create`, `deploy --create-workspace`, and the programmatic `createWorkspace()` now reject a folder ID without an organization ID with a clear error instead of failing with an internal error.

`workspace create` now uses organization and folder IDs from `--env-file`, even when no user defaults are stored. Previously these values were ignored; a folder-only env file now fails unless an organization is also given. Command-line options take precedence, and empty env-file values are treated as not given.
