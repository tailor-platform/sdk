---
"@tailor-platform/sdk": patch
---

Fix service deletion order to prevent "used by gateway(s)" error

When deleting subgraph services (TailorDB, Pipeline, Auth, IdP), the deletion would fail with an error like "Failed to delete AuthService: auth xxx is used by gateway(s)" because the Application was still referencing them.

This fix separates the deletion phases:

- `delete-resources`: Deletes resources (types, resolvers, clients, etc.) before Application update
- `delete-services`: Deletes services after Application is deleted

This ensures services are deleted only after the Application no longer references them.
