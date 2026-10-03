---
"@tailor-platform/sdk": minor
---

`tailor secret create` and `tailor secret update` now read the secret value from standard input when `--value` is omitted, keeping it out of shell history and process listings: `printf '%s' "$VALUE" | tailor secret create --vault-name <vault> --name <name>`. The piped value can be up to 128 KiB, and one trailing newline is removed from it. Without `--value`, a terminal or empty standard input fails with `SECRET_VALUE_REQUIRED`.
