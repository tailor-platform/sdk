---
"@tailor-platform/sdk": patch
---

Build the SDK with tsgo (file-by-file ESM emit) plus a postbuild script instead of the tsdown bundler. The published package is no longer a single bundle: modules are emitted per file and third-party dependencies resolve from the consumer's `node_modules` at runtime. The private `@tailor-platform/tailor-proto` workspace package is vendored into `dist/_proto` so the unbundled output stays self-contained. No public API changes.
