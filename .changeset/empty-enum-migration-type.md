---
"@tailor-platform/sdk": patch
---

Fix `tailordb migration generate` emitting invalid TypeScript in `db.ts` when a migration removes every allowed value from an enum field; the write slots are now typed as `never`.
