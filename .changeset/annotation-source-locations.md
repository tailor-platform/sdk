---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": patch
---

Point GitHub Actions annotations at the file that failed. `tailor seed validate` reports the offending JSONL file and line, and a rejected config reports its file, so the annotation links straight to the source. The annotation's line counts blank lines; the line printed in the report text still skips them, so the two differ on a file that contains one.
