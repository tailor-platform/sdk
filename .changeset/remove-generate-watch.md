---
"@tailor-platform/sdk": major
---

Remove the `generate --watch` (`-W`) flag. `tailor generate` now always runs a single generation pass; re-run the command after making changes instead of relying on the watcher to regenerate automatically.
