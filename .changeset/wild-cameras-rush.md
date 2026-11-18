---
"@tailor-platform/create-sdk": patch
---

Newly scaffolded projects, except those from the `content-mapper` template, run type-aware linting (`oxlint --type-aware`) with `tsrs`, which is faster and uses less memory than `oxlint-tsgolint`. Existing projects on `oxlint` 1.92.0 or later can switch by replacing the `oxlint-tsgolint` devDependency with `tsrs`, unless their `tsconfig.json` sets `contentMappers`: `tsrs` then fails lint because content mappers need `--runExternalCode`.
