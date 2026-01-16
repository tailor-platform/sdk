---
"@tailor-platform/sdk": major
---

**Breaking Change:** Rename `tailordb migrate` command to `tailordb migration`

The migration command has been renamed from `migrate` to `migration` for better consistency. Update your scripts and documentation:

- `tailor-sdk tailordb migrate generate` → `tailor-sdk tailordb migration generate`

**New Features:**

- Add `tailordb migration set` command to manually set migration checkpoint
  - Useful for skipping failed migrations or resetting migration state
  - Supports `--namespace`, `--yes`, `--workspace-id`, and `--profile` options
  - Always shows warnings before changing checkpoint

- Add `tailordb migration status` command to show migration status
  - Displays current migration number and pending migrations
  - Shows migration descriptions when available
  - Supports `--namespace` option to filter by namespace

- Add `--init` option to `migration generate` command
  - Deletes existing migration directories and starts fresh
  - Shows confirmation prompt (can be skipped with `--yes`)
  - Useful for resetting migration history

**Documentation:**

- Updated all CLI documentation to reflect new command names
- Added comprehensive documentation for new `set` and `status` commands
- Added usage examples and warnings for all new features
