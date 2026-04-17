<!-- politty:command:skills:heading:start -->

## skills

<!-- politty:command:skills:heading:end -->

<!-- politty:command:skills:description:start -->

Manage Tailor SDK agent skills.

<!-- politty:command:skills:description:end -->

<!-- politty:command:skills:usage:start -->

**Usage**

```
tailor-sdk skills [command]
```

<!-- politty:command:skills:usage:end -->

<!-- politty:command:skills:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:skills:global-options-link:end -->

<!-- politty:command:skills:subcommands:start -->

**Commands**

| Command                             | Description                                                        |
| ----------------------------------- | ------------------------------------------------------------------ |
| [`skills install`](#skills-install) | Install the tailor-sdk agent skill from the installed SDK package. |

<!-- politty:command:skills:subcommands:end -->
<!-- politty:command:skills install:heading:start -->

### skills install

<!-- politty:command:skills install:heading:end -->

<!-- politty:command:skills install:description:start -->

Install the tailor-sdk agent skill from the installed SDK package.

<!-- politty:command:skills install:description:end -->

<!-- politty:command:skills install:usage:start -->

**Usage**

```
tailor-sdk skills install [options]
```

<!-- politty:command:skills install:usage:end -->

<!-- politty:command:skills install:options:start -->

**Options**

| Option            | Alias | Description                                                                  | Required | Default         |
| ----------------- | ----- | ---------------------------------------------------------------------------- | -------- | --------------- |
| `--agent <AGENT>` | `-a`  | vercel/skills agent name (e.g. claude-code, codex). Defaults to claude-code. | No       | `"claude-code"` |
| `--yes`           | `-y`  | Auto-approve prompts.                                                        | No       | `false`         |

<!-- politty:command:skills install:options:end -->

<!-- politty:command:skills install:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:skills install:global-options-link:end -->
