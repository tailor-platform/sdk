---
"@tailor-platform/sdk": minor
---

Add `tailor.sandbox` (beta) for running commands and managing files in an isolated sandbox from Functions. Import the typed wrapper from `@tailor-platform/sdk/runtime/sandbox` (also exported as `sandbox` from `@tailor-platform/sdk/runtime`), or use the ambient `tailor.sandbox` types from `@tailor-platform/sdk/runtime/globals`. A sandbox created without `name` is destroyed when the execution ends; pass `name` to keep it and reopen it later with `getByName` or `getOrCreate`. Unit tests can use the in-memory `mockSandbox()` from `@tailor-platform/sdk/vitest`.
