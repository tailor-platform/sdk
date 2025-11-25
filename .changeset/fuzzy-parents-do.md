---
"@tailor-platform/sdk": patch
---

Load resolver and executor files only once

By reusing the results when files have already been loaded, file loading logs are no longer displayed multiple times during apply.
