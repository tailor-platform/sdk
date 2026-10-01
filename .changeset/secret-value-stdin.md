---
"@tailor-platform/sdk": minor
---

Add `--value-stdin` to `tailor secret create` and `tailor secret update`, which reads the secret value from standard input instead of the command line, keeping it out of shell history and process listings: `printf '%s' "$VALUE" | tailor secret create --vault-name <vault> --name <name> --value-stdin`. The piped value can be up to 128 KiB, and one trailing newline is removed from it. Passing neither `--value` nor `--value-stdin` now fails with `SECRET_VALUE_REQUIRED`, and passing both fails with `SECRET_VALUE_OPTIONS_CONFLICT`.
