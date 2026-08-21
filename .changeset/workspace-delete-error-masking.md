---
"@tailor-platform/sdk": patch
---

Report the real error when the workspace lookup in `tailor workspace delete` fails for a reason other than the workspace not existing (e.g. network or authentication errors), instead of always claiming the workspace was not found.
