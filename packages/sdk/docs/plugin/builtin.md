# Builtin Plugins (Beta)

> **Beta Feature**: The plugin system is currently in beta. APIs may change in future releases.

The SDK includes several builtin plugins for common use cases.

## @tailor-platform/changeset

Enables workflow-based change management for TailorDB types. When attached to a type, it generates the necessary types to support draft creation, approval workflows, and record activation.

### Generated Types

For a type named `User`, the plugin generates:

| Type                    | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `UserChangeRequest`     | Tracks change request lifecycle and approval status |
| `UserChangeStep`        | Individual approval steps within a request          |
| `UserChangeApproval`    | Approval decisions by individual approvers          |
| `UserChangeReworkEvent` | Records when changes are sent back for rework       |

### Extended Fields

The source type is extended with fields for version tracking:

- `recordId` - Unique identifier for the logical record
- `recordState` - Current state: `DRAFT`, `ACTIVE`, or `ARCHIVED`
- `archivedSeq` - Sequence number for archived versions
- `effectiveFrom` / `effectiveTo` - Validity period
- `requestedBy` / `requestedAt` - Request metadata
- `currentApprover` / `approvers` - Approval tracking

### Usage

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
    role: db.enum(["ADMIN", "USER"]),
  })
  .plugin({
    "@tailor-platform/changeset": true,
  });
```

### Configuration

Register in `tailor.config.ts`:

```typescript
export const plugins = definePlugins("@tailor-platform/changeset");
```

## @tailor-platform/audit-log

Generates a standalone audit log type for tracking changes across all types in a namespace. This is a **standalone plugin** that doesn't require attachment to specific types.

### Generated Types

| Type       | Description                                |
| ---------- | ------------------------------------------ |
| `AuditLog` | Universal audit log for all record changes |

### AuditLog Fields

- `targetType` - Name of the type that was modified
- `targetId` - ID of the modified record
- `action` - The action performed: `CREATE`, `UPDATE`, or `DELETE`
- `performedBy` - User ID who performed the action
- `performedAt` - Timestamp of the action
- `changes` - Summary of what changed
- `previousValues` - JSON snapshot before the change
- `newValues` - JSON snapshot after the change
- `metadata` - Additional context information

### Usage

No type attachment required. Simply register the plugin:

```typescript
export const plugins = definePlugins("@tailor-platform/audit-log");
```

The `AuditLog` type will be generated in each TailorDB namespace.

## @tailor-platform/change-history

Tracks change history for individual TailorDB types. When attached to a type, it generates a history type and executors to automatically capture all changes.

### Generated Types

For a type named `Customer`, the plugin generates:

| Type              | Description                                  |
| ----------------- | -------------------------------------------- |
| `CustomerHistory` | Records each change made to Customer records |

### Generated Executors

| Executor                     | Trigger        | Description                  |
| ---------------------------- | -------------- | ---------------------------- |
| `customer-history-on-create` | Record created | Captures initial values      |
| `customer-history-on-update` | Record updated | Captures before/after values |
| `customer-history-on-delete` | Record deleted | Captures final values        |

### History Fields

- `recordId` - ID of the tracked record
- `action` - The action: `CREATE`, `UPDATE`, or `DELETE`
- `performedBy` - User ID who performed the action
- `performedAt` - Timestamp of the action
- `previousValues` - JSON snapshot before the change
- `newValues` - JSON snapshot after the change
- `changedFields` - JSON array of field names that changed

### Usage

```typescript
import { db } from "@tailor-platform/sdk";

export const customer = db
  .type("Customer", {
    name: db.string(),
    email: db.string(),
  })
  .plugin({
    "@tailor-platform/change-history": true,
  });
```

### Configuration

Register in `tailor.config.ts`:

```typescript
export const plugins = definePlugins("@tailor-platform/change-history");
```

## Combining Multiple Plugins

You can attach multiple plugins to a single type:

```typescript
export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
  })
  .plugin({
    "@tailor-platform/changeset": true,
    "@tailor-platform/change-history": true,
  });
```

And register all plugins together:

```typescript
export const plugins = definePlugins(
  "@tailor-platform/changeset",
  "@tailor-platform/audit-log",
  "@tailor-platform/change-history",
);
```

## Type Safety

The SDK provides type-safe plugin configuration. Unknown plugin IDs or invalid configurations will be flagged by TypeScript:

```typescript
// TypeScript error: unknown plugin ID
.plugin({
  "@unknown/plugin": true,
})

// TypeScript error: invalid config type
.plugin({
  "@tailor-platform/changeset": "invalid", // expects boolean
})
```

To add type definitions for custom plugins, see [Custom Plugins](./custom.md).
