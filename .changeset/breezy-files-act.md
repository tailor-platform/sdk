---
"@tailor-platform/sdk": patch
---

Use pathe for cross-platform path handling

Replaced `node:path` with `pathe` across CLI modules to ensure consistent path separator handling on all operating systems. This eliminates the need for manual path separator normalization (e.g., `.replace(/\\/g, "/")`) and improves reliability on Windows.
