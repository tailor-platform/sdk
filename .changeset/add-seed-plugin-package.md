---
"@tailor-platform/sdk-plugin-seed": minor
---

New Tailor CLI plugin providing the `tailor seed` commands (`apply`, `validate`), extracted from the `exec.mjs` script that `seedPlugin` used to generate. `tailor seed apply` seeds TailorDB (and IdP `_User`) data from the generated JSONL files with the same options as the old script (`--machine-user`, `--namespace`, `--skip-idp`, `--truncate`, `--yes`, type-name arguments), and `tailor seed validate` validates the JSONL data against the generated schemas. The machine user and data location now come from the seedPlugin options in `tailor.config.ts` at run time.
