---
"@tailor-platform/sdk-plugin-seed": minor
---

Add `tailor seed validate --upsert` to check that TailorDB seed rows supply an `id` and all required fields before running `seed apply --upsert`. It checks the configured seed data and selected datasets, supports `--no-base`, and leaves IdP users identified by name. It cannot be combined with a positional path.
