---
"@tailor-platform/sdk": patch
---

When the Platform or the network reports a request as unavailable or rate-limited after the Platform may already have accepted it, the CLI no longer resends a write whose repeat would run something again or leave a second resource in use. Scripts that `tailor query` and `tailor function run` run, executor jobs that `tailor executor trigger` starts, workflow resumes by `tailor workflow resume` and by deploy migrations, and tokens that `tailor user pat create` and `tailor user pat update` create are no longer applied twice; these commands, and other writes such as `tailor tailordb truncate`, report the error instead. Requests that never reached the Platform are still retried.
