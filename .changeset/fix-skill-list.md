---
"@tailor-platform/sdk": patch
---

fix(skills): rename bundled skill directory to `agent-skills/` so `gh skill install tailor-platform/sdk` resolves a single skill. `gh skill` uses a recursive `**/skills/*/SKILL.md` match and was picking up both `skills/tailor-sdk/` (the public mirror) and `packages/sdk/skills/tailor-sdk/` (the npm bundle), erroring with conflicting names. The bundled copy is now under `packages/sdk/agent-skills/` (excluded from gh's match), while the repo-root `skills/` mirror remains the single discovery target for `gh skill install` and `npx skills add <repo>`. `npx tailor-sdk skills install` continues to work via the bundled `agent-skills/` path inside the published package.
