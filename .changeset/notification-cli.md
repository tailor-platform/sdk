---
"@tailor-platform/sdk": minor
---

New `tailor notification` commands read the platform notifications sent to you (alerts, incidents, maintenance notices and announcements), the same inbox the Console shows:

- `tailor notification list` lists your inbox, with `--category`, `--severity`, `--unread`, `--scope-workspace` and `--scope-organization` filters and shows the 50 newest by default (`--limit N` to change it, `--limit 0` for all).
- `tailor notification read <id...>` prints a notification (title, metadata, body, and action links, with Console paths given as full Console URLs) and marks it read; `--no-mark-read` only displays it.
- `tailor notification dismiss <id>` removes a notification from your inbox.

All three support `--json`.
