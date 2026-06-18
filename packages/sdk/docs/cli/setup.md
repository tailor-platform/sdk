# Setup Commands

Commands for setting up project infrastructure.

<!-- politty:command:setup:heading:start -->

## setup

<!-- politty:command:setup:heading:end -->

<!-- politty:command:setup:description:start -->

Generate a CI deploy workflow for your project. (beta)

<!-- politty:command:setup:description:end -->

<!-- politty:command:setup:usage:start -->

**Usage**

```
tailor-sdk setup [options] [command]
```

<!-- politty:command:setup:usage:end -->

<!-- politty:command:setup:subcommands:start -->

**Commands**

| Command                       | Description                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- |
| [`setup check`](#setup-check) | Audit generated workflows for drift against the current config/repo (read-only). |

<!-- politty:command:setup:subcommands:end -->
<!-- politty:command:setup check:heading:start -->

### setup check

<!-- politty:command:setup check:heading:end -->

<!-- politty:command:setup check:description:start -->

Audit generated workflows for drift against the current config/repo (read-only).

<!-- politty:command:setup check:description:end -->

<!-- politty:command:setup check:usage:start -->

**Usage**

```
tailor-sdk setup check
```

<!-- politty:command:setup check:usage:end -->

<!-- politty:command:setup check:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:setup check:global-options-link:end -->

<!-- politty:command:setup:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:setup:global-options-link:end -->

## Further reading

- [GitHub Actions Integration](../github-actions.md) — usage guide: targets, generated files, secrets, approval gates, and rollback.
