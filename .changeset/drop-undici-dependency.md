---
"@tailor-platform/sdk": patch
---

Remove the `undici` dependency. Running the CLI no longer replaces the process-wide HTTP stack with a bundled `undici` build.
