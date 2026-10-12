---
"@tailor-platform/sdk": patch
---

Make `tailor deploy` report which TailorDB tables stay restricted when a failed migration cannot be fully restored or rolled back, and give recovery steps and `--json` error context for a skipped restoration after a checkpoint conflict or an unverifiable checkpoint
