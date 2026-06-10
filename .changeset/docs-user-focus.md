---
"@tailor-platform/sdk": patch
---

Reword CLI `--help` text and the bundled documentation to describe user-facing behavior instead of internal implementation details. The `api` and `function logs` command notes no longer expose internal terms such as proto/RPC names, the `TestExecScript` API, or bundle sourcemap/content-hash mechanics, and the auth docs drop the internal "SDK vs Platform Naming" note. No runtime behavior changes.
