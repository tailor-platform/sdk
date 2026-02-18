---
"@tailor-platform/sdk": patch
---

Restore backward compatibility for programmatic CLI API options.

- Keep legacy `startWorkflow` options (`name`, `machineUser`, etc.) as deprecated `StartWorkflowOptions`
- Keep legacy `triggerExecutor` options (`executorName`, etc.) as deprecated `TriggerExecutorOptions`
- Expose typed options as `StartWorkflowTypedOptions` and `TriggerExecutorTypedOptions`
- Support both legacy and typed option shapes via function overloads
