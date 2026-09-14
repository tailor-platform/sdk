---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": patch
---

Point GitHub Actions annotations at the file that failed. `tailor seed validate` reports the offending JSONL file and line, and a rejected config reports its file, so the annotation links straight to the source. Seed line numbers now count blank lines, which the reported line previously skipped.
