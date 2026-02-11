# Fix mismatch between migration version and plugin-generated resources

## Problem

When applying a specific migration version using `TAILOR_INTERNAL_APPLY_MIGRATION_VERSION`, TailorDB types are filtered to that version, but the following resources are not filtered:

1. **gqlPermissions** - attempts to create permissions for types that do not exist
2. **relation fields** - plugin-added relations (via `extends`) reference types that do not exist

## Reproduction

### gqlPermission issue

1. A plugin generates types with `gqlPermission`.
2. Run apply with `TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "0000"`.
3. Error: `Failed to create TailorDBGQLPermission: failed to create gqlPermission: record not found`

### relation field issue

1. A plugin adds relation fields to an existing type via `extends`.
2. The relation references a plugin-generated type.
3. Run apply with `TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "0000"`.
4. Error: `RefType "UserChangeRequest" specified in "User"."userChangeRequests" is not found`

## Where it happens

Apply workflow step "Apply initial migration (0000)":

```yaml
- name: Apply initial migration (0000)
  run: pnpm run apply
  env:
    TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "0000"
```

## Root cause

In the apply logic under `packages/sdk/src/cli/apply/services/tailordb/`:

- TailorDB types are filtered by migration version.
- gqlPermissions are not filtered and attempt to create permissions for all types.

## Expected behavior

When `TAILOR_INTERNAL_APPLY_MIGRATION_VERSION` is set, gqlPermissions should be filtered by the same migration version.

Types that do not exist in migration version 0000 (e.g., plugin-generated types) should not have gqlPermissions created.

## Files to investigate

- `packages/sdk/src/cli/apply/services/tailordb/index.ts`
- `packages/sdk/src/cli/apply/services/tailordb/gql-permission.ts` (if it exists)
- Any location that applies migration-version filtering

## Reference: success vs failure

### Success (soft-delete plugin)

`Deleted_Customer` is generated, but no gqlPermission is defined:

```
TailorDB types:
  + Customer
  + Deleted_Customer  (plugin-generated)
  ...

TailorDB gqlPermissions:
  + Customer
  ...
  (Deleted_Customer is not included)
```

### Failure (changeset plugin)

`UserChangeRequest` is not created in migration 0000, but gqlPermission still attempts to create it:

```
TailorDB types:
  + Customer
  + User
  ...
  (UserChangeRequest is not created in migration 0000)

TailorDB gqlPermissions:
  + Customer
  + User
  + UserChangeRequest  ← fails because the type does not exist
  ...
```

## Related PR

- #560 (feat/plugin-changeset-example) - Apply fails due to this issue
