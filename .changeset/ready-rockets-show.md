---
"@tailor-platform/sdk": patch
---

`tailor deploy` now finishes deleting the tables a migration removed when an earlier deploy committed that migration but failed or was interrupted before deleting them, instead of stopping with remote schema drift until you delete them by hand. The deploy lists those tables among its deletions and deletes them with their data after confirmation, and `tailor tailordb migration validate` reports them as tables the next deploy deletes.
