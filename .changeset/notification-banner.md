---
"@tailor-platform/sdk": minor
---

After a command finishes in an interactive terminal, `tailor` now lists your unread WARNING and CRITICAL platform notifications briefly on stderr, with a pointer to `tailor notification list`. It is best effort: the lookup runs alongside the command, and if it has not answered when the command ends, `tailor` waits at most 150 ms more before dropping it. It never changes a command's exit code, and it marks nothing read. It keeps appearing after each command until you read the notifications with `tailor notification read` or dismiss them. After a failed lookup it pauses for 5 minutes, so a platform outage does not cost a request per command. It is never shown in CI, under `--json`, in a pipe, or after `login`, `logout`, `auth`, `api`, `query` and the `notification` commands themselves. Set `TAILOR_NOTIFICATION_BANNER=off` to turn it off.
