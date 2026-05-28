---
"@tailor-platform/sdk": minor
---

`tailor-sdk deploy` now waits until the application's GraphQL schema composition becomes healthy after the apply phase, so that composition errors surface before the command exits instead of silently leaving the app broken.

- Default timeout: 5 minutes. Override with `--wait <duration>` (e.g., `--wait 10m`, `--wait 30s`).
- Skip with `--no-wait` to restore the previous behavior.
- Skipped automatically for deploys without subgraphs (static-only, delete-only).
