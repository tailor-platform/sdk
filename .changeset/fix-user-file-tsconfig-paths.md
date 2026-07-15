---
"@tailor-platform/sdk": patch
---

Fix tsconfig `paths` alias resolution for dynamically loaded resolver, executor, workflow, HTTP adapter, and TailorDB type files. Previously, an import like `import { foo } from "@/utils"` in one of these files would fail to resolve when the file lived outside the directory tsx was registered from (e.g. in multi-app setups). Each file's `paths` aliases are now resolved as a fallback from its own tsconfig, based on the importing file's own directory.
