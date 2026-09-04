---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Support Vitest 5 in `@tailor-platform/sdk/vitest` (including `tailorRuntime({ config })` secret seeding for configs that use `test.projects`) and scaffold new projects with Vitest 5. The `tailor-runtime` environment no longer removes the `performance` global during tests: Vitest 5's module loader reads it while resolving `import()` calls, and the deploy-time free-variable check already treats `performance` as a runtime global.
