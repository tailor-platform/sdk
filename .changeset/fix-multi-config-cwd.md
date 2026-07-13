---
"@tailor-platform/sdk": patch
---

Resolve each config's `files` glob patterns and bundler `tsconfig` relative to the directory of the file that calls `defineConfig()` instead of the invocation `cwd`, so `--config a/tailor.config.ts,b/tailor.config.ts` no longer lets one app's file glob or path aliases bleed into another. If a `files` pattern matches nothing under the new directory, it falls back to resolving against `cwd` as before, so existing configs whose patterns were written against the invocation directory keep working.
