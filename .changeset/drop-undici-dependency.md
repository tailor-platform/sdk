---
"@tailor-platform/sdk": patch
---

Remove the `undici` dependency. The CLI now closes Node.js' built-in HTTP connection pool directly when it needs to, so running the CLI no longer replaces the process-wide HTTP stack with a bundled `undici` build.
