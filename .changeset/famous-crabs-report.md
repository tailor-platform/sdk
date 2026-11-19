---
"@tailor-platform/sdk": patch
---

Pre-flight validation in `tailor deploy` now also checks TailorDB GraphQL permissions and function uploads. A GraphQL permission policy with no actions, or a resolver, executor, workflow job, or Auth hook bundle over 20 MiB, now fails before deploy applies anything, instead of during apply, where an oversized bundle failed with `HTTP 503`.
