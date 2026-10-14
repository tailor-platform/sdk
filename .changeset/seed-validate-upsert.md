---
"@tailor-platform/sdk-plugin-seed": minor
---

Add `tailor seed validate --upsert` to check that TailorDB seed rows supply an `id` and the required fields checked by `seed apply --upsert` before applying data. It checks the configured seed data and selected datasets, supports `--no-base`, and leaves IdP users identified by name. It cannot be combined with a positional path. Update this plugin together with the setup plugin when generating branch or tag seeding workflows, which use the new validation option.
