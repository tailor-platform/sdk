---
"@tailor-platform/sdk": patch
---

Report the real error when the folder lookup in `tailor organization folder delete` fails for a reason other than the folder not existing (e.g. network or authentication errors), instead of always claiming the folder was not found.
