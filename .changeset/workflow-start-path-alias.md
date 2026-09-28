---
"@tailor-platform/sdk": patch
---

Fix `workflow.start()` and job `.start()` calls not being rewritten when the workflow file is imported through a `tsconfig.json` `compilerOptions.paths` alias (e.g. `import workflow from "@/workflow/syncGLBalances"`). Previously only relative imports were recognized, so the call built and deployed but failed at runtime with "workflow.start() is rewritten at build time and unavailable in the bundle".
