---
"@tailor-platform/sdk": patch
---

Fix `workflow.trigger()` calls in resolvers, executors, and workflow jobs failing at runtime when called without an options argument, or with options passed as a variable, a spread, or an object without a literal `authInvoker` property. All these forms are now rewritten at build time as the documented `trigger(args, options?)` signature promises; previously they compiled but threw "workflow.trigger() is rewritten at build time and unavailable in the bundle" after deploy.
