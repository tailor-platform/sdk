---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration test` skips a blank or whitespace-only line between rows of a seed JSONL file, as `tailor seed validate` does, instead of rejecting it as invalid JSON. A malformed row is now reported at the line it is on, counting blank lines.
