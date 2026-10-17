---
"@tailor-platform/sdk": patch
---

Move the TailorDB guides under `docs/services/tailordb/`: the service guide is now `docs/services/tailordb/index.md` and the migration guide `docs/services/tailordb/migration.md`. Add a `docs/data-clone.md` guide for `tailor data clone`, and note that `tailor tailordb migration test --data clone` copies TailorDB records only, without the `--copy-files` and `--copy-idp-users` options of `data clone`.
