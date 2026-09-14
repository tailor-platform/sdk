---
"@tailor-platform/sdk": patch
---

Propagate failures from the default subcommand a parent CLI command runs, so shortcuts like `tailor workspace`, `tailor workflow`, `tailor secret vault`, and `tailor executor webhook` exit non-zero and print the same error as their explicit `list` form instead of exiting 0 with no output. Scripts and CI steps that relied on the exit code of a parent shortcut now see authentication and other failures.
