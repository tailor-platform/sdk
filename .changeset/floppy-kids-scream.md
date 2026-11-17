---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration test` skips a blank or whitespace-only line between rows of a seed JSONL file, as `tailor seed validate` does, instead of rejecting it as invalid JSON. A malformed row is now reported at the line it is on, counting blank lines. It also reports invalid JSON for a row with whitespace that JSON does not allow, such as U+00A0 (no-break space) or a second byte order mark, as `tailor seed validate` does; it used to accept such whitespace before the first row and after the last row.
