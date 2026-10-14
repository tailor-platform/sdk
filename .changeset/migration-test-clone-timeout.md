---
"@tailor-platform/sdk": minor
---

Add `--clone-timeout` to `tailor tailordb migration test` to set how long `--data clone` waits for the data clone to finish, for example `30s` or `10m`. The default is now 30 minutes, up from 5, and the option is rejected with `--data seed`. If your CI job time limit is shorter than 30 minutes, pass a shorter `--clone-timeout` so the command can time out and delete its temporary workspace before the job is stopped.
