---
"@tailor-platform/sdk": minor
---

Add new migration management commands and features:

- Add `tailordb migration set` command to manually set migration checkpoint
  - Useful for skipping failed migrations or resetting migration state
  - Supports `--namespace`, `--yes`, `--workspace-id`, and `--profile` options
  - Always shows warnings and requires confirmation before changing checkpoint

- Add `tailordb migration status` command to show migration status
  - Displays current migration number and pending migrations
  - Shows migration descriptions from diff.json when available
  - Supports `--namespace` option to filter by specific namespace

- Add `--init` option to `migration generate` command
  - Deletes existing migration directories and starts fresh
  - Shows confirmation prompt with list of directories to be deleted
  - Can be combined with `--yes` to skip confirmation
  - Useful for completely resetting migration history
