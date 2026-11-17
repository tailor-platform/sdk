---
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk": patch
---

The GitHub Actions error annotation now links to the JSONL file and line when `tailor seed apply`, `tailor seed validate --upsert`, or `tailor tailordb migration test --data seed` rejects a seed row while reading the seed files: a row that is not valid JSON or not a JSON object, a row without `id` or a required field with `--upsert`, or a row defined in more than one data directory. The error names the file relative to the current directory, before the message, as other errors that point at a file do: `seed/data/User.jsonl:2: Invalid JSON: ...` instead of `Invalid JSON in /path/to/app/seed/data/User.jsonl at line 2: ...`.
