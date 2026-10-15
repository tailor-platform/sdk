---
"@tailor-platform/sdk": patch
---

Clarify in `tailor workspace prune --help` and error suggestions that location options must be given on the command line and that the defaults from `tailor user update` are not used. Warn before an unscoped sweep that every visible workspace is a candidate for the name and age filters, including with `--yes` or `--dry-run`.
