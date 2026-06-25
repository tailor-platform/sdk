---
"@tailor-platform/sdk": major
---

chore: replace tsx with amaro for TypeScript loading

Removes `tsx` (which pulled in esbuild's native binaries, ~10.5 MB) from
`dependencies` and replaces it with `amaro` (~3.8 MB, zero transitive deps).

A small `ts-hook.mjs` provides the Node.js module hook with both a resolver
(`.ts` extension fallback) and a load hook (`amaro` for full TypeScript
support including enums). Dev-only scripts now use
`node --experimental-strip-types` instead.

Raises the minimum Node.js version to 22.15.0 (from >=22) to use
`module.registerHooks()`, which allows synchronous hook registration directly
in the main thread without a worker thread.
