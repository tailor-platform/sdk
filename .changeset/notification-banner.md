---
"@tailor-platform/sdk": minor
---

After a command finishes in an interactive terminal, `tailor` now lists your unread WARNING and CRITICAL platform notifications briefly on stderr, with a pointer to `tailor notification list`. It is best effort: the lookup runs alongside the command and is dropped if it has not answered by the time the command ends, so it never slows a command or changes its exit code, and it marks nothing read. It is shown at most once every 30 minutes and waits 5 minutes after a failed lookup, so a platform outage does not cost a request per command; it is never in CI, under `--json`, in a pipe, or after `login`, `logout`, `auth`, `api`, `query` and the `notification` commands themselves. Set `TAILOR_NOTIFICATION_BANNER=off` to turn it off.
