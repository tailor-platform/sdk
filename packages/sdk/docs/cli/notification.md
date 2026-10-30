---
description: "List, read and dismiss the platform notifications sent to you from the tailor CLI."
---

# Notification Commands

Commands for reading the platform notifications addressed to you: alerts you must act on,
incidents, maintenance notices and announcements. The inbox is per user, so these commands take a
profile (for its login) but no workspace. Marking a notification read or dismissing it in the CLI
also changes it in the Console, which shows the same inbox.

## notification

Read the platform notifications sent to you.

**Usage**

```
tailor notification [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                         | Description                              |
| ----------------------------------------------- | ---------------------------------------- |
| [`notification list`](#notification-list)       | List the notifications in your inbox.    |
| [`notification read`](#notification-read)       | Show a notification and mark it as read. |
| [`notification dismiss`](#notification-dismiss) | Remove a notification from your inbox.   |

### notification dismiss

Remove a notification from your inbox.

**Usage**

```
tailor notification dismiss [options] <id>
```

**Arguments**

| Argument | Description     | Required |
| -------- | --------------- | -------- |
| `id`     | Notification ID | Yes      |

**Options**

| Option                | Alias | Description       | Required | Default | Env                       |
| --------------------- | ----- | ----------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### notification list

List the notifications in your inbox.

**Usage**

```
tailor notification list [options]
```

**Options**

| Option                                      | Alias | Description                                                     | Required | Default  | Env                       |
| ------------------------------------------- | ----- | --------------------------------------------------------------- | -------- | -------- | ------------------------- |
| `--order <ORDER>`                           | -     | Sort order (asc or desc)                                        | No       | `"desc"` | -                         |
| `--limit <LIMIT>`                           | `-l`  | Maximum number of items to return (0: unlimited)                | No       | `50`     | -                         |
| `--profile <PROFILE>`                       | `-p`  | Workspace profile                                               | No       | -        | `TAILOR_PLATFORM_PROFILE` |
| `--category <CATEGORY>`                     | -     | Only this category (alert, incident, maintenance, announcement) | No       | -        | -                         |
| `--severity <SEVERITY>`                     | -     | Only this severity or higher (info, warning, critical)          | No       | -        | -                         |
| `--unread`                                  | -     | Only unread notifications                                       | No       | `false`  | -                         |
| `--scope-workspace <SCOPE_WORKSPACE>`       | -     | Only notifications about this workspace ID                      | No       | -        | -                         |
| `--scope-organization <SCOPE_ORGANIZATION>` | -     | Only notifications about this organization ID                   | No       | -        | -                         |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### notification read

Show a notification and mark it as read.

**Usage**

```
tailor notification read [options] <id>
```

**Arguments**

| Argument | Description                  | Required |
| -------- | ---------------------------- | -------- |
| `id`     | Notification ID (repeatable) | Yes      |

**Options**

| Option                | Alias | Description                                      | Required | Default | Env                       |
| --------------------- | ----- | ------------------------------------------------ | -------- | ------- | ------------------------- |
| `--no-mark-read`      | -     | Show the notification without marking it as read | No       | `false` | -                         |
| `--profile <PROFILE>` | `-p`  | Workspace profile                                | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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
