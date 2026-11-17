---
"@tailor-platform/sdk-plugin-seed": patch
---

`tailor seed apply` and `tailor seed validate --upsert` skip a blank or whitespace-only line between rows of a seed JSONL file, as `tailor seed validate` already does without `--upsert`, instead of rejecting it as invalid JSON. Errors about a row now give the line it is on, counting blank lines. `tailor seed apply` now reports invalid JSON for a row with whitespace that JSON does not allow, such as U+00A0 (no-break space) or a second byte order mark, as `tailor seed validate` already does; it used to accept such whitespace before the first row and after the last row.
