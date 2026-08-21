---
"@tailor-platform/sdk": patch
---

Report the real error when the folder lookup in `tailor organization folder delete` fails (e.g. the organization does not exist, or network/authentication errors), instead of always claiming the folder was not found.
