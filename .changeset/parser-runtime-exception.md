---
"@tailor-platform/sdk": patch
---

Eliminate the parser-layer exception that allowed `parser/service/tailordb/runtime.ts` to re-export runtime helpers from the configure module. Plugin attachment processing for a TailorDB type now lives in `PluginManager.processAttachmentsForType` and returns plain data (extended type, generated types, render events), so the cli layer applies state and renders progress without depending on `TailorAnyDBType`. Internal refactor with no public API change.
