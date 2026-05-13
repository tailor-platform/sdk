# Crash Report Commands

Commands for managing crash reports.

<!-- politty:command:crashreport:heading:start -->

## crashreport

<!-- politty:command:crashreport:heading:end -->

<!-- politty:command:crashreport:description:start -->

Manage crash reports.

**Aliases:** `crash-report`

<!-- politty:command:crashreport:description:end -->

<!-- politty:command:crashreport:usage:start -->

**Usage**

```
tailor-sdk crashreport [command]
```

<!-- politty:command:crashreport:usage:end -->

<!-- politty:command:crashreport:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:crashreport:global-options-link:end -->

<!-- politty:command:crashreport:subcommands:start -->

**Commands**

| Command                                 | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| [`crashreport list`](#crashreport-list) | List local crash report files.                 |
| [`crashreport send`](#crashreport-send) | Submit a crash report to help improve the SDK. |

<!-- politty:command:crashreport:subcommands:end -->
<!-- politty:command:crashreport list:heading:start -->

### crashreport list

<!-- politty:command:crashreport list:heading:end -->

<!-- politty:command:crashreport list:description:start -->

List local crash report files.

<!-- politty:command:crashreport list:description:end -->

<!-- politty:command:crashreport list:usage:start -->

**Usage**

```
tailor-sdk crashreport list [options]
```

<!-- politty:command:crashreport list:usage:end -->

<!-- politty:command:crashreport list:options:start -->

**Options**

| Option            | Alias | Description                                              | Required | Default  |
| ----------------- | ----- | -------------------------------------------------------- | -------- | -------- |
| `--order <ORDER>` | -     | Sort order (asc or desc)                                 | No       | `"desc"` |
| `--limit <LIMIT>` | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        |

<!-- politty:command:crashreport list:options:end -->

<!-- politty:command:crashreport list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:crashreport list:global-options-link:end -->
<!-- politty:command:crashreport send:heading:start -->

### crashreport send

<!-- politty:command:crashreport send:heading:end -->

<!-- politty:command:crashreport send:description:start -->

Submit a crash report to help improve the SDK.

<!-- politty:command:crashreport send:description:end -->

<!-- politty:command:crashreport send:usage:start -->

**Usage**

```
tailor-sdk crashreport send [options]
```

<!-- politty:command:crashreport send:usage:end -->

<!-- politty:command:crashreport send:options:start -->

**Options**

| Option          | Alias | Description                   | Required | Default |
| --------------- | ----- | ----------------------------- | -------- | ------- |
| `--file <FILE>` | -     | Path to the crash report file | Yes      | -       |

<!-- politty:command:crashreport send:options:end -->

<!-- politty:command:crashreport send:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:crashreport send:global-options-link:end -->
