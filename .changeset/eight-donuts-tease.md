---
"@tailor-platform/sdk": patch
---

`tailorRuntime({ config })` now names the file, line, and parse error when `tailor.config.ts` or a file it imports does not parse, instead of reporting `[object Object]` against `tailor.config.ts`.
