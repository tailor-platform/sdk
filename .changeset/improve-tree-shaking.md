---
"@tailor-platform/sdk": patch
---

Improve tree-shaking of `@tailor-platform/sdk` so applications that only import a subset of the public API ship less unused code:

- Add a selective `sideEffects` allow-list to `package.json`: only `dist/cli/*.mjs` and `dist/vitest/setup.mjs` retain side effects, the rest of `dist/` is marked side-effect-free so bundlers can drop modules whose only imports are unused.
- Replace the top-level `export const t = { ..._t }` spread in `configure/index.ts` with a direct alias, eliminating a side-effecting object construction that prevented elimination of unused field builders.
- Drop the redundant runtime `throw` in `defineAuth` for the `userProfile` / `machineUserAttributes` mutex. The type system already rejects the conflict at compile time and the CLI parser (`AuthConfigSchema`) still rejects it at deploy / generate time, so configs that bypassed the type system (e.g. `@ts-ignore`) and set both fields now fail at the CLI parse step instead of at `defineAuth()` call time.
- Annotate configure-layer factories (`defineConfig`, `defineAuth`, `defineIdp`, `defineStaticWebSite`, `definePlugins`, `createResolver`, `createExecutor`, `createWorkflow`, `createWorkflowJob`, etc.) with `@__NO_SIDE_EFFECTS__` so calls whose return values are unused can be eliminated.

No public API surface changes.
