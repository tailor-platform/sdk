## skills

Manage Tailor SDK agent skills.

**Usage**

```
tailor skills [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                           | Description                                   |
| --------------------------------- | --------------------------------------------- |
| [`skills sync`](#skills-sync)     | Remove and reinstall Tailor SDK agent skills. |
| [`skills add`](#skills-add)       | Install Tailor SDK agent skills.              |
| [`skills remove`](#skills-remove) | Remove installed Tailor SDK agent skills.     |
| [`skills list`](#skills-list)     | List Tailor SDK agent skills.                 |

### skills add

Install Tailor SDK agent skills.

**Usage**

```
tailor skills add [name]
```

**Arguments**

| Argument | Description                             | Required |
| -------- | --------------------------------------- | -------- |
| `name`   | Skill name(s) to install (default: all) | No       |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### skills list

List Tailor SDK agent skills.

**Usage**

```
tailor skills list
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### skills remove

Remove installed Tailor SDK agent skills.

**Usage**

```
tailor skills remove [name]
```

**Arguments**

| Argument | Description                         | Required |
| -------- | ----------------------------------- | -------- |
| `name`   | Skill name to remove (default: all) | No       |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### skills sync

Remove and reinstall Tailor SDK agent skills.

**Usage**

```
tailor skills sync [options]
```

**Options**

| Option                | Alias | Description                      | Required | Default |
| --------------------- | ----- | -------------------------------- | -------- | ------- |
| `--exclude <EXCLUDE>` | `-x`  | Skill names to exclude from sync | No       | `[]`    |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
