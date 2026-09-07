---
"@tailor-platform/sdk": patch
---

Report a member removed inside a nested field as a data-loss warning in `tailordb migration generate`, so `migration validate --strict` requires an acknowledgment; the pre-migration phase keeps the removed member readable for `migrate.ts`, a compatible member added at the same level is named as a possible rename target, and the diff output lists changed nested members
