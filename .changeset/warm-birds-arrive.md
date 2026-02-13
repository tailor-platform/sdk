---
"@tailor-platform/sdk": minor
---

Always generate exec.mjs for seed generator and add --machine-user option

- exec.mjs is now generated regardless of whether `machineUserName` is configured
- Added `--machine-user` (`-m`) CLI option to specify machine user at runtime
- CLI argument takes precedence over config default, allowing override
- Shows clear error message when machine user is not specified and not configured
