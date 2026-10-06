---
"@tailor-platform/sdk": patch
---

`fillSeedData` (`tailor seed fill`) now stops without writing any file when a seed JSONL file was changed by another tool while it ran, instead of overwriting that change, and fills the first row of a file that starts with a byte order mark instead of skipping it
