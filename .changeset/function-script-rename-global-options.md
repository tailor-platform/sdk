---
"@tailor-platform/sdk-codemod": patch
---

Fix `v3/function-script-rename` skipping a command line that puts a global option between its tokens, such as `tailor --json function script a.ts`, `tailor function --verbose script a.ts`, or `tailor -e .env function script a.ts`. The codemod now skips every spelling of `--verbose`, `--json`, `--env-file`, and `--env-file-if-exists` that the CLI accepts, and reports one that a package runner starts or that a script passes as an argv array, such as `['function', '--envFile', '.env local', 'script']`.
