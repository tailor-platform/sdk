---
"@tailor-platform/sdk": patch
---

fix: allow index on array-type foreign key fields for federation

Array-type UUID fields with relations were incorrectly getting `index: false`, causing federation errors ("RefField must be set to Index=true"). Foreign key fields now always get `index: true` regardless of array status.
