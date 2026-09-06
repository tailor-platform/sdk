---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
---

Add lint rules that catch workflow mistakes the build otherwise reports only at `tailor generate` / `tailor deploy` time: `valid-workflow-job-definition` (a `createWorkflowJob` `name` that is not a string literal or a `body` that is not an inline function), `no-job-start-outside-body` (a job's `.start()` called outside any job body in the same file), `no-direct-exec-job-function` (calling `execJobFunction` directly instead of `.start()`), and `valid-workflow-exports` (a `createWorkflow` result that is not the default export, or a job that is not a named export). Two more rules flag, in files that define a resolver, executor, workflow job, or HTTP adapter, the Node-only globals (`no-node-only-globals`) and Node built-in module imports (`no-node-builtin-imports`) that the runtime lacks, with the same suggested alternatives the build prints. All six rules are enabled in newly scaffolded projects.
