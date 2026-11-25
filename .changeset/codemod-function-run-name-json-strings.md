---
"@tailor-platform/sdk-codemod": patch
---

`tailor upgrade` checks each string of a `package.json` separately when it looks for `tailor generate --watch` and `tailor function run --name`, so a `package.json` written on one line no longer reports a `--watch` or `--name` flag that belongs to another script.
