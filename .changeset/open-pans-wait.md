---
"@tailor-platform/tailor-sdk": patch
---

Exported some commands as functions

Exported `tailor-sdk workspace create|delete|list` and `tailor-sdk machineuser list|token` as functions. The allowed options are the same except for CLI-specific ones (e.g., `--format`, `--yes`)

```typescript
import { machineUserToken } from "@tailor-platform/tailor-sdk/cli";

const tokens = await machineUserToken({ name: "admin" });
```
