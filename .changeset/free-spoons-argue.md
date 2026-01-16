---
"@tailor-platform/sdk": minor
---

Add `--env-file-if-exists` option for optional environment file loading

Added a new CLI option `--env-file-if-exists` that loads environment files only if they exist, without throwing an error when the file is missing. This is useful for loading optional local configuration files like `.env.local`.

Environment file loading now follows Node.js `--env-file` behavior:

- Variables already set in the environment are not overwritten
- Later files override earlier files when multiple are specified
