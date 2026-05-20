---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` so an intermediate migration's data script can still read fields that a later migration removes. Each migration's pre/post phase now submits the schema state reconstructed up to that migration (initial baseline + diffs through N), instead of the FINAL post-all-migrations schema. Previously, removals declared in later migrations leaked into earlier migrations' pre-phase and caused `field 'X' not found` failures at script execution time.
