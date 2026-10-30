---
description: "List, read and dismiss the platform notifications sent to you from the tailor CLI."
politty:
  index:
    title: "Notification Commands"
    description: "Commands for reading platform notifications."
---

# Notification Commands

Commands for reading the platform notifications addressed to you: alerts you must act on,
incidents, maintenance notices and announcements. The inbox is per user, so these commands take a
profile (for its login) but no workspace. Marking a notification read or dismissing it in the CLI
also changes it in the Console, which shows the same inbox.

{{politty:command:notification}}

When no subcommand is provided, defaults to `list`.

**Output (default):**

```
┌──────────────────────────────────────┬──────────┬─────────────┬───────────────────────────────┬────────────────┬─────────────┐
│ id                                   │ severity │ category    │ title                         │ arrivedAt      │ readAt      │
├──────────────────────────────────────┼──────────┼─────────────┼───────────────────────────────┼────────────────┼─────────────┤
│ 0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e │ warning  │ maintenance │ Scheduled maintenance on Nov 3 │ 2 hours ago    │ unread      │
│ 1d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e │ info     │ announcement│ Platform notifications are live│ 3 days ago     │ 2 days ago  │
└──────────────────────────────────────┴──────────┴─────────────┴───────────────────────────────┴────────────────┴─────────────┘
```

`tailor notification read <id>` prints the title, the metadata, the body as plain text (it is
Markdown, shown as written) and the action links, then marks the notification read. Pass
`--no-mark-read` to only display it. Several IDs can be given at once.

Notifications are never deleted by the CLI: `dismiss` removes one from your inbox, and the
platform expires or revokes them on its own schedule.
