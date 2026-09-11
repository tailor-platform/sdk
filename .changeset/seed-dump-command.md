---
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk": minor
---

Add `tailor seed dump`, which writes the rows currently in TailorDB out as JSONL seed data. The output is the format `tailor seed apply` reads, so a dump taken before a change is what restores the tables after it: `tailor seed apply --truncate` puts the dumped rows back. Dump every table, one namespace with `--namespace`, or the tables you name; `--out` writes the files somewhere other than the seed data directory, and existing files are only overwritten with `--force`. IdP `_User` records are not dumped.
