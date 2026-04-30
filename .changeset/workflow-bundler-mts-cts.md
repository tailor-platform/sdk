---
"@tailor-platform/sdk": patch
---

Fix workflow job bundling to also transform `workflow.trigger()` and `job.trigger()` calls in `.mts`, `.cts`, `.mjs`, and `.cjs` files. Previously the rolldown transform plugin only matched `.ts` and `.js`, so trigger calls in non-default extensions were silently left as raw method calls and failed at runtime. The default-import resolver also strips trailing extensions so `import wf from "./simple.mjs"` resolves to the same workflow as `import wf from "./simple"`.
