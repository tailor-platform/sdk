---
"@tailor-platform/sdk": minor
---

Add `--keep-ttl` to `tailor tailordb migration test` to record an expiry, for example `24h` or `7d`, on the temporary workspace that `--keep` retains, so `tailor workspace prune --expired` can delete it later. It requires `--keep`.
