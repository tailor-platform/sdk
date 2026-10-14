---
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk": minor
"@tailor-platform/create-sdk": minor
---

Add `tailor seed studio` to browse and edit seed data in a local web UI instead of editing the JSONL files by hand. It serves the data directory under the seedPlugin `distPath` at `http://127.0.0.1:4848` until you stop it (`--port` picks another port, `--open` opens it in your browser, and `--json` prints the address as JSON):

```bash
tailor seed studio
```

A save is checked against the generated seed schema files, so a value they reject is not written. It writes the fields you entered plus the `id` generated for a new row, and leaves the values the table fills in on create, such as `createdAt`, out of the file. Run `tailor seed validate` before `tailor seed apply`, since rows that reference each other across tables are only valid together once each of them is saved. Newly scaffolded projects get a `seed:studio` script next to `seed:validate`.

The same is available as `startSeedStudio` from `@tailor-platform/sdk/seed`.
