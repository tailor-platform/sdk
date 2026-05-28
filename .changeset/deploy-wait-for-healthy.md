---
"@tailor-platform/sdk": minor
---

`tailor-sdk deploy` now waits until the application's GraphQL schema composition becomes healthy after the apply phase. The platform's `UpdateApplication` (gateway compose) is synchronous and only returns after the new schema is composed and recorded, so deploy re-issues it on every run — even when the application body is unchanged — to guarantee that composition errors surface before the command exits instead of silently leaving the app in a broken state.
