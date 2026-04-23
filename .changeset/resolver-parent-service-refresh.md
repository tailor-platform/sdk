---
"@tailor-platform/sdk": patch
---

Fix differential deploys so a newly created / updated / deleted resolver on an existing pipeline service is reachable from GraphQL without a full redeploy. `apply` now refreshes the parent pipeline service whenever a child resolver changes, so the gateway re-composes the subgraph schema.
