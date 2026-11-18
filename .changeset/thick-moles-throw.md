---
"@tailor-platform/sdk-plugin-seed": patch
---

`tailor seed apply` now lists each `_User` row that repeats a `name` at its file and line, for example `seed/data/_User.jsonl:3 (alice): duplicate of seed/data/_User.jsonl:1`, instead of by its position among the loaded rows (`Row 2 (alice): duplicate of row 1`), which did not match the line in the file after a blank line or for a row in a dataset file. The GitHub Actions error annotation now links to the first repeated row.
