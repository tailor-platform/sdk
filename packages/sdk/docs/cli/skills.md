## skills

Manage Tailor SDK agent skills.

**Usage**

```
tailor-sdk skills [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                             | Description                                                        |
| ----------------------------------- | ------------------------------------------------------------------ |
| [`skills install`](#skills-install) | Install the tailor-sdk agent skill from the installed SDK package. |

### skills install

Install the tailor-sdk agent skill from the installed SDK package.

**Usage**

```
tailor-sdk skills install [options]
```

**Options**

| Option            | Alias | Description                                                                  | Required | Default         |
| ----------------- | ----- | ---------------------------------------------------------------------------- | -------- | --------------- |
| `--agent <AGENT>` | `-a`  | vercel/skills agent name (e.g. claude-code, codex). Defaults to claude-code. | No       | `"claude-code"` |
| `--yes`           | `-y`  | Auto-approve prompts.                                                        | No       | `false`         |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
