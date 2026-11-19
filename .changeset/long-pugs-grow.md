---
"@tailor-platform/sdk": patch
---

Apply a relation that a TailorDB migration moves to another table or key only after `migrate.ts` runs, as for a relation added to an existing field, so a migration step that updates rows still pointing at the old target no longer fails on deploy
