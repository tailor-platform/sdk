---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Resolve the `tailor`, `tailor-seed`, and `tailor-tailordb-erd` executables through committed compile-cache launchers. The `tailor seed` command is now available as soon as the plugin is installed, and the seed and ERD plugin CLIs reuse Node's on-disk compile cache for faster warm starts.
