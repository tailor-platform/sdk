---
"@tailor-platform/sdk-codemod": patch
---

Fix `tailor upgrade` reporting zero codemods across several v2 prerelease boundaries. `v2/db-type-to-table` and `v2/runtime-subpath-namespace` now trigger at `2.0.0-next.4` (where they actually shipped) instead of `2.0.0-next.3`, and `v2/forward-relation-name`, `v2/tailordb-validate-simplify`, and `v2/tailordb-hook-redesign` now trigger at `2.0.0-next.5` instead of `2.0.0-next.4`.
