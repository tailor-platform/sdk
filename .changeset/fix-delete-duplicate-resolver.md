---
"@tailor-platform/sdk": patch
---

Fix deletion of resolvers that conflict with system-generated ones

When a TailorDB type is created (e.g., `User`), the system auto-generates resolvers like `deleteUser`, `createUser`, etc. If a user created a custom resolver with the same name, it could not be deleted because the Application update (SDL composition) failed before the deletion phase.

This fix reorders the apply phases to delete subgraph services before updating the Application:

1. Create/Update services that Application depends on (subgraphs + StaticWebsite)
2. Delete subgraph services (before Application update to avoid SDL conflicts)
3. Create/Update Application
4. Create/Update services that depend on Application (Executor, Workflow)
5. Delete services that depend on Application, then Application itself
