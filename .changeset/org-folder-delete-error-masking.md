---
"@tailor-platform/sdk": patch
---

Report the real error when the folder lookup in `tailor organization folder delete` fails with something other than "not found" (e.g. network, permission, or authentication errors), instead of always claiming the folder was not found.
