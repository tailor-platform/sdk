---
"@tailor-platform/sdk": minor
---

`setup` (beta): restructure the command surface

**Breaking changes (beta)**

- `tailor-sdk setup github` is now `tailor-sdk setup`. The CI provider is selected with the optional `--provider` / `-p` flag, which defaults to `github`; any other value is rejected.
- The drift audit moved from the `setup github --check` flag to a dedicated `tailor-sdk setup check` subcommand (no provider flag — it audits every target recorded in `.github/tailor-sdk.lock`).
