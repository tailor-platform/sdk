---
"@tailor-platform/sdk": patch
---

Fix tsconfig `paths` alias resolution for dynamically loaded resolver, executor, workflow, HTTP adapter, and TailorDB type files. Previously, an import like `import { foo } from "@/utils"` in one of these files could fail to resolve, or resolve against the wrong project's alias target, when resolved outside the directory tsx was registered from (e.g. in multi-app setups). Each file's `paths` aliases are now resolved from its own tsconfig, based on the importing file's own directory.
