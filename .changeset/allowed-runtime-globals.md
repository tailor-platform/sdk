---
"@tailor-platform/sdk": minor
---

When a resolver, executor, or workflow job fails to build with `FORBIDDEN_RUNTIME_GLOBAL` because it references a Node-only global such as `process` or `Buffer`, the error now names where the reference is: the file in your own code, or the installed package (code under `node_modules`). A reference from an installed package can be allowed with the new `allowedRuntimeGlobals` option of `defineConfig()`, keyed by package name, with the globals to allow or `true` for all of them — for example `allowedRuntimeGlobals: { "@ai-sdk/gateway": ["Buffer"] }` — once you have confirmed that the package's code referencing it never runs for your use. The error's suggestion shows the entry to add. `allowedRuntimeGlobals` has no effect on your own code.
