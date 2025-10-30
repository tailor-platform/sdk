---
"@tailor-platform/tailor-sdk": patch
---

Changed how workspaceID and authentication credentials are specified

Previously, authentication credentials were stored in the tailorctl config file (`~/.tailorctl/config`), but we've changed to store them in a new format file (`~/.config/tailor-platform/config.yaml`). When you run SDK commands, migration happens automatically, so generally no user action is required.
We've also changed how workspaceID is specified during apply. Previously, you specified workspaceID in the configuration file (`tailor.config.ts`), but we've removed this. Instead, please specify `--workspace-id` flag or `TAILOR_PLATFORM_WORKSPACE_ID` environment variable when running the apply command.

```bash
tailor-sdk apply --workspace-id <your-workspace-id>
# or
TAILOR_PLATFORM_WORKSPACE_ID=<your-workspace-id> tailor-sdk apply
```
