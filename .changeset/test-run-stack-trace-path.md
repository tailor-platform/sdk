---
"@tailor-platform/sdk": patch
---

Fix `tailor-sdk function test-run` showing stack trace paths with a spurious `../` prefix (e.g. `../.tailor-sdk/test-run/test-run--add.entry.js`). Sourcemap `sources` are now emitted relative to the current working directory, and cwd-relative paths that start with a dotfile directory (e.g. `.tailor-sdk/...`) are explicitly prefixed with `./` in the display.
