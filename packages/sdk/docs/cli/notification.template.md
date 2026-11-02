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

When no subcommand is provided, defaults to `list`.

{{politty:command:notification}}

**Output (default):**

```
┌──────────────────────────────────────┬──────────┬──────────────┬─────────────────────────────────┬─────────────┬────────────┐
│ id                                   │ severity │ category     │ title                           │ arrivedAt   │ readAt     │
├──────────────────────────────────────┼──────────┼──────────────┼─────────────────────────────────┼─────────────┼────────────┤
│ 0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e │ warning  │ maintenance  │ Scheduled maintenance on Nov 3  │ 2 hours ago │ unread     │
│ 1d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e │ info     │ announcement │ Platform notifications are live │ 3 days ago  │ 2 days ago │
└──────────────────────────────────────┴──────────┴──────────────┴─────────────────────────────────┴─────────────┴────────────┘
```

`tailor notification read <id>` prints the title, the metadata, the body as plain text (it is
Markdown, shown as written) and the action links, then marks the notification read. Pass
`--no-mark-read` to only display it. Several IDs can be given at once. If some of them are not
found, the others are still shown and marked read, and the command then fails naming the missing
IDs. With a read-only login, the notifications are shown but not marked read, and a warning says
so.

`tailor notification dismiss <id>` removes a notification from your inbox. This cannot be undone:
`read` and `list` no longer show it. It needs a profile that is not read-only. Notifications you
do not dismiss stay until the platform expires or revokes them.
