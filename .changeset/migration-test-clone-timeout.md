---
"@tailor-platform/sdk": minor
---

Add `--clone-timeout` to `tailordb migration test` to set how long `--data clone` waits for the copy to finish (default 30 minutes, previously a fixed 5 minutes). When the wait times out, the error now includes the clone operation ID and states that the copy keeps running on the platform.
