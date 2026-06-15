---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Remove deprecated CLI aliases for the v2 command surface. Use `tailor-sdk deploy` instead of `tailor-sdk apply`, `tailor-sdk crashreport` instead of `tailor-sdk crash-report`, and the hyphenated `--machine-user` option instead of the hidden `--machineuser` alias.

Fix the v2 CLI rename codemod to migrate the hidden `--machineuser` option to `--machine-user`.
