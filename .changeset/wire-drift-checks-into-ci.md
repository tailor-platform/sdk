---
"@tailor-platform/sdk": patch
---

No user-facing change. CI now runs the generated-file drift checks that were previously only reachable through `pnpm check` on a developer's machine — the agent rule index, the migration doc generated from the codemod registry, and public API JSDoc coverage — so a change that forgets the matching `:update` command fails review instead of landing with a stale generated copy.
