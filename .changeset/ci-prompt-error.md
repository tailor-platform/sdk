---
"@tailor-platform/sdk": patch
---

fix: throw error for prompts in CI environments

In CI environments, interactive prompts cause the CLI to hang indefinitely. This change detects CI environments using `std-env` and throws a `CIPromptError` when `logger.prompt` is called, instructing users to use the `--yes` flag to skip confirmation prompts.
