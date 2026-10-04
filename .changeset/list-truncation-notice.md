---
"@tailor-platform/sdk": patch
---

List commands now say when `--limit` cut their output short. When more items exist than `--limit` allows, the list is followed by `More results exist beyond --limit N. Raise --limit to see more.` on stderr, so a caller can tell a complete list from a partial one; stdout, including `--json` output, is unchanged. This matters most for `executor jobs`, `function logs`, and `workflow executions`, which list 50 items unless `--limit` says otherwise.
