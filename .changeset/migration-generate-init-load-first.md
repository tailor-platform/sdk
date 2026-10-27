---
"@tailor-platform/sdk": patch
---

Keep existing migration files when `tailordb migration generate --init` fails to load tables. Previously the migrations were deleted before the tables loaded, so an error such as a syntax error in a table file left the namespace with no migration history. The deletion confirmation now appears after the tables load.
