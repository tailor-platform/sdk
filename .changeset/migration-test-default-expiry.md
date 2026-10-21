---
"@tailor-platform/sdk": minor
---

`tailordb migration test` now records a 24-hour expiry on every temporary workspace it creates, right after creating it. If the run is interrupted (for example, a cancelled CI job), the workspace stays and `tailor workspace prune --expired` deletes it once the expiry has passed. A workspace given with `--target-workspace-id` gets no expiry, and `--keep` without `--keep-ttl` still records none.
