---
"@tailor-platform/sdk": patch
---

Introduce `WorkflowService` type and `createWorkflowService` factory to align workflow handling with the service pattern used by `ExecutorService`, `ResolverService`, and other services. Replace `Application.workflowConfig` with `Application.workflowService` that encapsulates workflow loading, data access, and log printing.
