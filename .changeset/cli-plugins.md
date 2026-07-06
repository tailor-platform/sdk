---
"@tailor-platform/sdk": minor
---

Add CLI plugin support (beta). Running `tailor <name>` for an unknown subcommand now executes an external `tailor-<name>` executable found on your PATH or in `node_modules/.bin` (project-local takes precedence), forwarding all following arguments. This also works for unknown subcommands nested under a known command — e.g. `tailor tailordb erd` dispatches to `tailor-tailordb-erd`. Builtins always take precedence, matching stops at the first unknown segment, and a command that takes its own arguments is never replaced by a plugin. The plugin receives the current Tailor Platform context via environment variables (`TAILOR_PLATFORM_TOKEN`, `TAILOR_PLATFORM_URL`, `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`, `TAILOR_PLATFORM_WORKSPACE_ID`, `TAILOR_PLATFORM_USER`, `TAILOR_CONFIG_PATH`, `TAILOR_VERSION`, `TAILOR_BIN`); token, workspace, and user are best-effort, so auth-free plugins still run when you are not logged in.

Also adds:

- `tailor auth token` — print a valid access token (refreshing it if expired) for use by plugins and scripts.
- `tailor plugin list` — list discovered plugins and their executable paths.
