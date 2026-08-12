---
"@tailor-platform/sdk": patch
---

Treat `migrate.test.ts` as a migration artifact: `tailordb migration rebaseline` now removes a test-only migration directory together with the history it belongs to, and aborts when one is added while its confirmation prompt is open.
