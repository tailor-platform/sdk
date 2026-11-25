---
"@tailor-platform/sdk-codemod": patch
---

`tailor upgrade` checks each string of a `package.json` separately when it looks for `tailor function run --name`, so a `package.json` written on one line does not report a script that does not use `--name`.
