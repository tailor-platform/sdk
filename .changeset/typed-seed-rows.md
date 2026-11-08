---
"@tailor-platform/sdk": patch
---

`createStandardSchema` now declares the row type through `~standard.types`. Tools that read a seed schema file, such as the lines-db studio, can list a table whose JSONL file has no rows and offer to add its first row.
