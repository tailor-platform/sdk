---
"@tailor-platform/sdk": patch
---

Fix unportable type error that `createResolver` raises in bundling.

Bundling files that export the return values of `createResolver` function has been causing `he inferred type of "X" cannot be named without a reference to "Y". This is likely not portable. A type annotation is necessary.` error. It was caused the return type of `Executor` type that is used internally by `createResolver` function is not exported.
