# Crash Report Commands

Commands for managing crash reports.

<!-- politty:command:crash-report:heading:start -->

## crash-report

<!-- politty:command:crash-report:heading:end -->

<!-- politty:command:crash-report:description:start -->

Manage crash reports.

<!-- politty:command:crash-report:description:end -->

<!-- politty:command:crash-report:usage:start -->

**Usage**

```
tailor-sdk crash-report [command]
```

<!-- politty:command:crash-report:usage:end -->

<!-- politty:command:crash-report:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:crash-report:global-options-link:end -->

<!-- politty:command:crash-report:subcommands:start -->

**Commands**

| Command                                   | Description                                    |
| ----------------------------------------- | ---------------------------------------------- |
| [`crash-report list`](#crash-report-list) | List local crash report files.                 |
| [`crash-report send`](#crash-report-send) | Submit a crash report to help improve the SDK. |

<!-- politty:command:crash-report:subcommands:end -->
<!-- politty:command:crash-report list:heading:start -->

### crash-report list

<!-- politty:command:crash-report list:heading:end -->

<!-- politty:command:crash-report list:description:start -->

List local crash report files.

<!-- politty:command:crash-report list:description:end -->

<!-- politty:command:crash-report list:usage:start -->

**Usage**

```
tailor-sdk crash-report list [options]
```

<!-- politty:command:crash-report list:usage:end -->

<!-- politty:command:crash-report list:options:start -->

**Options**

| Option            | Alias | Description                                              | Required | Default  |
| ----------------- | ----- | -------------------------------------------------------- | -------- | -------- |
| `--order <ORDER>` | -     | Sort order (asc or desc)                                 | No       | `"desc"` |
| `--limit <LIMIT>` | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        |

<!-- politty:command:crash-report list:options:end -->

<!-- politty:command:crash-report list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:crash-report list:global-options-link:end -->

<!-- politty:command:crash-report send:heading:start -->

### crash-report send

<!-- politty:command:crash-report send:heading:end -->

<!-- politty:command:crash-report send:description:start -->

Submit a crash report to help improve the SDK.

<!-- politty:command:crash-report send:description:end -->

<!-- politty:command:crash-report send:usage:start -->

**Usage**

```
tailor-sdk crash-report send [options]
```

<!-- politty:command:crash-report send:usage:end -->

<!-- politty:command:crash-report send:options:start -->

**Options**

| Option          | Alias | Description                   | Required | Default |
| --------------- | ----- | ----------------------------- | -------- | ------- |
| `--file <FILE>` | -     | Path to the crash report file | Yes      | -       |

<!-- politty:command:crash-report send:options:end -->

<!-- politty:command:crash-report send:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:crash-report send:global-options-link:end -->
