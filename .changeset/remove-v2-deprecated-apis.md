---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": patch
"@tailor-platform/sdk-codemod": minor
---

Remove the APIs that were marked `@deprecated` on the way to v2, so 2.0.0 ships without deprecated aliases. Each removal has migration coverage in `tailor upgrade`:

- `@tailor-platform/sdk/cli` no longer re-exports `kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, and `seedPlugin`. Import them from `@tailor-platform/sdk/plugin/kysely-type`, `/plugin/enum-constants`, `/plugin/file-utils`, and `/plugin/seed` (codemod `v2/plugin-cli-import`).
- `tailor.workflow.startJobFunction` and the `StartJobFunctionOptions` type are removed; use the canonical `execJobFunction` / `ExecJobFunctionOptions` (new codemod `v2/exec-job-function-rename`). `mockWorkflow()` no longer exposes the `startJobFunction` alias — assert on its `execJobFunction` mock instead — and `v2/workflow-trigger-rename` now rewrites `triggerJobFunction` straight to `execJobFunction`.
- `@tailor-platform/sdk/test` no longer exports the platform-global mocks `setupTailordbMock`, `setupWorkflowMock`, `setupWaitPointMock`, `setupInvokerMock`, and `setupTailorErrorsMock`, nor the bundled-output helper `createImportMain`. Use the `tailor-runtime` environment from `@tailor-platform/sdk/vitest` with `mockTailordb` / `mockWorkflow` (migration guidance: `v2/sdk-test-mocks-to-vitest`). `createTailorDBHook`, `createStandardSchema`, and `unauthenticatedTailorUser` are unchanged.
- The programmatic CLI functions no longer accept name-keyed options: `GetWorkflowOptions`, `StartWorkflowOptions`, `ListWorkflowExecutionsOptions`, `GetExecutorOptions`, `TriggerExecutorOptions`, `ListExecutorJobsOptions`, `GetExecutorJobOptions`, and `WatchExecutorJobOptions` are removed along with the overloads that took them. Pass the definition itself — `startWorkflow({ workflow: myWorkflow, invoker: "admin" })`, `watchExecutorJob({ executor: myExecutor, jobId })` — which also types `arg` and `payload` from the definition (migration guidance: `v2/cli-typed-options`). The name-keyed entry points remain available as CLI commands (`tailor workflow start <name>`, `tailor executor trigger <name>`).
