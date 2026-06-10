---
"@tailor-platform/sdk": patch
---

Treat `console.log` as a DEBUG-level call when bundling deployment functions, matching the platform's OpenTelemetry severity mapping. With `logLevel: "INFO"` or higher, `console.log` calls are now dropped alongside `console.debug`. The default `"DEBUG"` level still keeps all console calls.
