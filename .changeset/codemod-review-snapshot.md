---
"@tailor-platform/sdk-codemod": patch
---

Keep LLM review detection working in multi-major upgrades: each codemod's review detector and suspicious patterns now inspect the file as of that codemod's position in the transform chain, so a later codemod's rewrite can no longer silently hide an earlier codemod's review findings.
