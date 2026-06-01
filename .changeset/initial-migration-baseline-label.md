---
"@tailor-platform/sdk": patch
---

fix(tailordb): set the migration label to `0000` on the first apply

The initial schema snapshot (`0000`) is deployed through the normal
create-update flow and never reports itself as a pending migration, so the
first `tailor-sdk deploy` after `tailordb migration generate` previously left
the namespace without an `sdk-migration` label. This forced a redundant
apply/generate/apply sequence to establish the baseline. The migration label is
now reconciled to the latest local migration after every create-update apply, so
a single `migration generate` + `deploy` establishes the baseline as documented.
