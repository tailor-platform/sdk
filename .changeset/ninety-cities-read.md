---
"@tailor-platform/tailor-sdk": patch
---

Added show command

Added a command to retrieve information about deployed applications. This can be used to obtain application endpoints after deployment in CI and similar environments.

```bash
tailor-sdk apply --workspace-id <your-workspace-id>
tailor-sdk show --workspace-id <your-workspace-id> -f json | jq -r '.url'
```
