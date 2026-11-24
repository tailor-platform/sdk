---
"@tailor-platform/sdk-codemod": patch
---

Fix `tailor upgrade` skipping a command line that puts a global option between its tokens, such as `tailor --json function test-run a.ts`, `tailor function --verbose test-run a.ts`, `tailor-sdk --envFile .env apply`, or `tailor-sdk --no-json crash-report list`. The `v2/apply-to-deploy`, `v2/cli-rename`, `v2/test-run-arg-input`, and `v3/function-test-run-rename` codemods now skip every spelling of `--verbose`, `--json`, `--env-file`, and `--env-file-if-exists` that the CLI accepts, including `--no-json`, camelCase names such as `--envFile`, and joined short flags such as `-je .env`. When `v3/function-test-run-rename` cannot rewrite a command that a package runner starts, it now also reports one that has a global option between `function` and `test-run`.
