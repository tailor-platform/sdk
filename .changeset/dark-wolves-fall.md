---
"@tailor-platform/sdk": patch
---

Failures the CLI raises outside its command modules now carry their own `error.code` in `--json` output instead of `UNEXPECTED_ERROR`, with the fix in `suggestion` and the facts behind the failure in `context`. Plain output prints them as `Error [CODE]: …` followed by a `Suggestion:` line.

- Config and definitions: `CONFIG_NOT_FOUND`, `DEFINITION_NAME_DUPLICATE` for TailorDB table names that repeat within a namespace or across the application's TailorDB namespaces (every duplicated name is listed under `context.duplicates`), `PUBLISH_EVENTS_CONFLICT`, `LOG_LEVEL_INVALID`, `WORKFLOW_WAIT_POINT_KEY_INVALID`, and `CONFIG_INVALID` for duplicate IdP, static website and AI Gateway names, an AI Gateway without an Auth service, secrets without a value, a `userProfile` type that no TailorDB namespace defines, and invalid `seedPlugin` options.
- Bundling: `HTTP_ADAPTER_ASYNC_UNSUPPORTED`, `HTTP_ADAPTER_NODE_IMPORT_UNSUPPORTED`, `HTTP_ADAPTER_BUNDLE_TOO_LARGE`, `TAILORDB_VALIDATOR_ASYNC_UNSUPPORTED`, `TAILORDB_HOOK_UNRESOLVED_REFERENCE`, `TAILORDB_PERMISSION_INVALID`, `WORKFLOW_JOB_UNDETECTABLE`, `WORKFLOW_SOURCE_PARSE_FAILED`, `WORKFLOW_START_TARGET_UNDETECTABLE`.
- Plugins and seed: `PLUGIN_TABLE_INVALID`, `PLUGIN_NAMESPACE_HOOK_FAILED`, `SEED_PLUGIN_NOT_CONFIGURED`, `SEED_MESSAGE_SIZE_EXCEEDED`.
- Workspace, login and credentials: `WORKSPACE_ID_REQUIRED`, `WORKSPACE_ID_INVALID`, `PLATFORM_CONFIG_INVALID`, `PLATFORM_CONFIG_VERSION_UNSUPPORTED`, `USER_CONFIG_DIRECTORY_NOT_FOUND`, `KEYRING_READ_FAILED`, `AUTH_USER_INFO_FAILED`, `MACHINE_USER_TOKEN_FAILED`.
- `tailor query`: `QUERY_INPUT_REQUIRED`, `QUERY_NAMESPACE_UNRESOLVED`, `QUERY_NAMESPACE_AMBIGUOUS`, `QUERY_EXECUTION_FAILED`, `EDITOR_FAILED`; a query the CLI cannot parse is reported as `invalid_sql`, the code a parse failure on the Platform already has.
- Static website deploys: `STATIC_WEBSITE_UPLOAD_TIMEOUT`, `STATIC_WEBSITE_DEPLOY_TIMEOUT`.

A missing `--env-file` keeps `INVALID_ARGUMENTS` and gains a `suggestion`. Where the fix moved to `suggestion` or `details`, `error.message` of the errors thrown by `@tailor-platform/sdk/cli` functions such as `loadWorkspaceId`, `loadAccessToken`, `chunkSeedData` and `loadSeedContext` no longer contains it.
