---
"@tailor-platform/tailor-sdk": patch
---

Changed to display ID of created workspace

Made it easier to retrieve the ID of workspaces created with `tailor-sdk workspace create`.
This is useful for cases where you want to apply after creating a workspace in CI environments and similar scenarios.

```bash
tailor-sdk workspace create --name "my-workspace" --region asia-northeast --format json | jq -r '.id'
```
