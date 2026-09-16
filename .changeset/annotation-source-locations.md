---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": patch
---

Point GitHub Actions annotations at the file that failed. `tailor seed validate` reports the offending JSONL file and line, and a rejected config reports its file, so the annotation links straight to the source. Source the CLI cannot parse now reports the file it was found in and the line it failed on, which is the imported module rather than the config when the config imports it; such a failure previously surfaced as `Unknown error: [object Object]`, and under `--json` its `code` is now `UNEXPECTED_ERROR` rather than `UNKNOWN_ERROR`. The annotation's line counts blank lines; the line printed in the report text still skips them, so the two differ on a file that contains one.
