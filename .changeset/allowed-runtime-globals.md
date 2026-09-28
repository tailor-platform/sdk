---
"@tailor-platform/sdk": minor
---

A Node-only global such as `Buffer` or `process` referenced only by an installed package (code under `node_modules`) bundled into a resolver, executor, or workflow job no longer fails the build with `FORBIDDEN_RUNTIME_GLOBAL`. The build continues and prints a warning naming the package, since code in that package that reaches the global throws a `ReferenceError` at runtime. A reference from your own code still fails the build, and the error now names the file that references the global. To silence the warning for a package you have checked, add `buildOptions.allowedRuntimeGlobals` to `defineConfig()`, keyed by package name, with the globals to allow or `true` for all of them — for example `buildOptions: { allowedRuntimeGlobals: { "@ai-sdk/gateway": ["Buffer"] } }`.
