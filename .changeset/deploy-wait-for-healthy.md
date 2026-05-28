---
"@tailor-platform/sdk": minor
---

`tailor-sdk deploy` now waits until the application's GraphQL schema composition becomes healthy after the apply phase, so that composition errors surface before the command exits instead of silently leaving the app in a broken state.
