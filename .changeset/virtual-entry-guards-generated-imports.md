---
"@tailor-platform/sdk": patch
---

Apply the same import-rebasing guard to a bundler's inline virtual entry that the on-disk generated-entry resolver already used, so a specifier that cannot be rebased (a relative import, an absolute path, or another virtual module) falls through to normal resolution instead of failing the build.
