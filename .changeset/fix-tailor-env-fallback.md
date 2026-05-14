---
"@tailor-platform/sdk": patch
---

Widen `TailorEnv` fallback to `Record<string, string | number | boolean>` so it matches the values the type generator emits (string literal / number / boolean). Previously the fallback was `Record<string, string>`, which rejected number and boolean env values until `tailor.d.ts` was generated.
