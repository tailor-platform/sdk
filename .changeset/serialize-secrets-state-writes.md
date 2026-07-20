---
"@tailor-platform/sdk": patch
---

Fix concurrent deploys to the same workspace and application from one project directory causing a later deploy to silently skip a needed secret update. Secret and auth-connection updates are now serialized per workspace and application.
