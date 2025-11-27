---
"@tailor-platform/sdk": patch
---

Added the remove command

Added the remove command to delete all managed resources.

```bash
tailor-sdk remove [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to remove resources from
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-y, --yes` - Skip confirmation prompt
