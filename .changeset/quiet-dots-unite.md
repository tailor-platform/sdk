---
"@tailor-platform/sdk": minor
---

Unify CLI option short flags for consistency

**Breaking Changes:**

- `apply --dry-run`: Changed short flag from `-n` to `-d`
- `workspace create --name`: Changed short flag from `-N` to `-n`
- `workspace create --delete-protection`: Changed short flag from `-D` to `-d`
- `secret create --name`: Changed short flag from `-N` to `-n`
- `secret update --name`: Changed short flag from `-N` to `-n`
- `secret delete --name`: Changed short flag from `-N` to `-n`

**Documentation:**

- Updated CLI documentation to reflect the new short flags
- Added missing `staticwebsite` CLI documentation

**New Unified Rules:**

- `--name`: Always uses `-n`
- `--namespace`: Always uses `-n` (no conflict as it's in different commands)
- `--dry-run`: Uses `-d` (apply command)
- `--dir`: Uses `-d` (staticwebsite deploy command)
- `--delete-protection`: Uses `-d` (workspace create command)

Note: Short flags can be reused across different commands without conflicts.
