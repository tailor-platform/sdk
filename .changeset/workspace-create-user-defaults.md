---
"@tailor-platform/sdk": minor
---

Add `tailor user update --default-organization-id <id> [--default-folder-id <id>]` to store where `tailor workspace create`, workspace creation during `deploy`, and the programmatic `createWorkspace()` put new workspaces when neither organization nor folder is given. The defaults are kept per user and platform, and any explicit organization or folder, including through `TAILOR_PLATFORM_ORGANIZATION_ID` / `TAILOR_PLATFORM_FOLDER_ID` for CLI commands, replaces both. `deploy --create-workspace` also uses the resolved default location when checking whether an existing workspace matches. `workspace create`, `deploy --create-workspace`, and the programmatic `createWorkspace()` now reject a folder ID without an organization ID with a clear error instead of failing with an internal error.

`workspace create` and `deploy` now use organization and folder IDs from `--env-file`, even when no user defaults are stored. Previously these values were ignored; a folder-only env file now fails unless an organization is also given. Command-line options take precedence, and empty env-file values are treated as not given.
