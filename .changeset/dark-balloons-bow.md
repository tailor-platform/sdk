---
"@tailor-platform/sdk-plugin-seed": patch
---

`tailor seed apply` and `tailor seed validate --upsert` skip a blank or whitespace-only line between rows of a seed JSONL file, as `tailor seed validate` already does without `--upsert`, instead of rejecting it as invalid JSON. Errors about a row now give the line it is on, counting blank lines.
