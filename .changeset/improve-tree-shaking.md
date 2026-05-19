---
"@tailor-platform/sdk": patch
---

Improve tree-shaking of `@tailor-platform/sdk` so applications that only import a subset of the public API ship less unused code:

- Declare `"sideEffects": false` in `package.json` so bundlers can drop modules whose only imports are unused.
- Replace the top-level `export const t = { ..._t }` spread in `configure/index.ts` with a direct alias, eliminating a side-effecting object construction that prevented elimination of unused field builders.
- Drop a redundant runtime `throw` in `defineAuth`'s `external` branch; the surrounding union type already makes the case unreachable, and removing it lets the bundler strip the auth branch when unused.
- Annotate configure-layer factories (`defineConfig`, `defineAuth`, `defineIdp`, `defineStaticWebSite`, `definePlugins`, `createResolver`, `createExecutor`, `createWorkflow`, `createWorkflowJob`, etc.) with `@__NO_SIDE_EFFECTS__` so calls whose return values are unused can be eliminated.

No public API changes; runtime behavior is preserved.
