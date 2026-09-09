---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Support Vitest 5 in `@tailor-platform/sdk/vitest` and scaffold new projects with Vitest 5. `tailorRuntime({ config })` now seeds each project's secrets from that project's own root, so a run combining projects with different roots no longer loads one project's config for all of them. Projects keep resolving the same environment they did on Vitest 4: a project that omits `extends` inherits the root `tailor-runtime` environment only on Vitest 5, where that is Vitest's own default. The `tailor-runtime` environment no longer removes the `performance` global during tests: Vitest 5's module loader reads it while resolving `import()` calls, and the deploy-time free-variable check already treats `performance` as a runtime global.
