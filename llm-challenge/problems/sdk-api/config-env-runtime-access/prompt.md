Create a minimal Tailor SDK project for a small onboarding application.

The project should define one non-secret setting at the top-level project configuration and then use that same setting from runtime-facing code instead of reading Node environment variables inside deployed function code. Include a resolver-style operation, an executor-style handler, a workflow job, and an authentication hook that each use the setting in a small deterministic result, log message, or returned value.

Add a short note in the workspace explaining where the setting is defined and where runtime code reads it.

Keep the implementation small and leave the finished project files in this workspace.
