---
"@tailor-platform/sdk": minor
---

Add TailorDB schema migration feature. Migrations allow you to safely evolve your database schema with type-safe data transformations.

**Key Features:**

- **Local snapshot-based diff detection** - Detects field-level schema differences between current types and previous snapshots
- **Type-safe migration scripts** - Generates TypeScript migration scripts with Kysely transaction types
- **Transaction-wrapped execution** - All changes commit or rollback together for atomicity
- **Automatic execution during apply** - Pending migrations run as part of `tailor-sdk apply`
- **Migration checkpoint management** - Manually control which migrations have been applied
- **Migration status tracking** - View current state and pending migrations

**Commands:**

- `tailordb migration generate` - Generate migration files from schema changes (supports `--name`, `--yes`, `--init`)
- `tailordb migration set <number>` - Manually set migration checkpoint
- `tailordb migration status` - Show migration status and pending migrations

**Supported Schema Changes:**

The migration system automatically handles:

- Adding/removing optional fields (non-breaking)
- Adding required fields (breaking - migration script generated)
- Changing optional→required (breaking - migration script generated)
- Adding/removing indexes (non-breaking)
- Adding unique constraints (breaking - migration script generated)
- Adding/removing enum values (removing is breaking - migration script generated)
- Adding/removing types (non-breaking)

**Unsupported Changes:**

The following changes require a 3-step migration process:

- **Field type changes** (e.g., `string` → `integer`) - Add new field, migrate data, remove old field, then re-add with original name
- **Array to single value changes** - Add new single-value field, migrate data, remove array field, then re-add with original name

**Configuration:**

Configure migrations in `tailor.config.ts`:

```typescript
db: {
  tailordb: {
    files: ["./tailordb/*.ts"],
    migration: {
      directory: "./migrations",
      // Optional: specify machine user for migration execution
      // If not specified, the first machine user from auth.machineUsers is used
      machineUser: "admin-machine-user",
    },
  },
}
```
