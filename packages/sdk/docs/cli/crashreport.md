# Crash Report Commands

Commands for managing crash reports.

## crashreport

Manage crash reports.

**Aliases:** `crash-report`

**Usage**

```
tailor-sdk crashreport [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                 | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| [`crashreport list`](#crashreport-list) | List local crash report files.                 |
| [`crashreport send`](#crashreport-send) | Submit a crash report to help improve the SDK. |

### crashreport list

List local crash report files.

**Usage**

```
tailor-sdk crashreport list [options]
```

**Options**

| Option            | Alias | Description                                              | Required | Default  |
| ----------------- | ----- | -------------------------------------------------------- | -------- | -------- |
| `--order <ORDER>` | -     | Sort order (asc or desc)                                 | No       | `"desc"` |
| `--limit <LIMIT>` | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### crashreport send

Submit a crash report to help improve the SDK.

**Usage**

```
tailor-sdk crashreport send [options]
```

**Options**

| Option          | Alias | Description                   | Required | Default |
| --------------- | ----- | ----------------------------- | -------- | ------- |
| `--file <FILE>` | -     | Path to the crash report file | Yes      | -       |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
