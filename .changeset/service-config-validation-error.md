---
"@tailor-platform/sdk": patch
---

Report invalid configs and SDK definitions with specific error codes that list each offending field, instead of `UNEXPECTED_ERROR` carrying the raw validation output:

- `CONFIG_INVALID`: `tailor.config.ts` fails validation, in its top-level fields, its `plugins` export, or a TailorDB, IdP, Auth, static website, AI Gateway, or secret manager config. Each field is named by its path in the failing export, such as `auth.machineUserAttributes.role` or a `plugins` item's index. Under `--json`, `error.context` carries `file`, `exportName`, and `issues` (`path` and `message` per field), plus `configKey` and `name` for a service.
- `DEFINITION_INVALID`: a resolver, executor, TailorDB type, HTTP adapter, workflow, or workflow job fails validation. `error.context` carries `kind`, `file`, `exportName`, and `issues`.
- `OPTIONS_INVALID`: options passed to an SDK function such as `listWorkspaces()` fail validation. The message is unchanged, and `error.context.issues` lists each field.
- `DEFINITION_EXPORT_INVALID`: a workflow or HTTP adapter is exported under a name, or a workflow job is the default export. A misplaced workflow or job was previously reported with validation errors that did not apply to it.
