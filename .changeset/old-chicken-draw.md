---
"@tailor-platform/sdk": minor
---

Add `--watch` to `tailor function run`: it runs the function again each time you save the function file, a project file it imports, or the argument file, without deploying, and prints each run as `-->` / `<--` lines tagged with the execution ID. Add `--arg-file` to read the argument from a JSON file; without it, `--watch` creates a temporary argument file and prints its path. `--arg` is now validated before anything contacts the Platform, so invalid JSON fails even for a resolver without input.
