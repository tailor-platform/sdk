---
"@tailor-platform/sdk": patch
---

`fillSeedData` (`tailor seed fill`) now refuses to write any file when a seed JSONL file was changed by another tool after the fill read it, instead of overwriting that change, and fills the first row of a file that starts with a byte order mark instead of skipping it
