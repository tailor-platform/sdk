---
"@tailor-platform/sdk": patch
---

Resolve the bundler `tsconfig` for migration scripts, `tailor query`, and `tailor function test-run` from the bundled script's (or owning config's) directory instead of the invocation `cwd`, so path aliases keep working when the command runs against a config outside the current directory.
