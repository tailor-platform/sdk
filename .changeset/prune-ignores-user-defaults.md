---
"@tailor-platform/sdk": patch
---

State in `tailor workspace prune --help` and in its errors for an unscoped `--expired` or `--older-than 0s` sweep that locations must be given on the command line, and that the default organization and folder set by `tailor user update` are not used.
