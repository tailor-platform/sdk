---
"@tailor-platform/sdk": patch
---

Narrow the parsed TailorDB field type to the eleven field types the schema actually accepts (`uuid`, `string`, `boolean`, `integer`, `float`, `decimal`, `enum`, `date`, `datetime`, `time`, `nested`) instead of a bare string. Behavior is unchanged; the internal types now match what validation already enforced.
