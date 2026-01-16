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

**Configuration:**

Configure migrations in `tailor.config.ts`:

```typescript
db: {
  tailordb: {
    files: ["./tailordb/*.ts"],
    migration: {
      directory: "./migrations",
      machineUser: "admin-machine-user", // optional
      timeout: 600000, // optional
    },
  },
}
```
